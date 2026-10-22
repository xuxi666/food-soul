#!/usr/bin/env node
/**
 * 一键发布 / 同步脚本（本地执行）
 *
 *   node scripts/ship.mjs -m "feat: 说明"   提交本地改动并发布到服务器（服务器构建重启，并自动同步 GitHub）
 *   node scripts/ship.mjs --push-only       不提交，直接把当前 HEAD 发布到服务器
 *   node scripts/ship.mjs --status          查看服务器上一次部署结果
 *   node scripts/ship.mjs --install-hook    在服务器安装/更新部署钩子
 *   node scripts/ship.mjs --bootstrap       首次接管服务器：建 git 仓库 + 安装钩子（幂等）
 *   node scripts/ship.mjs --github-setup    在服务器生成 GitHub 部署密钥，并打印公钥
 *
 * 配置来源：.deploy.env（已被 .gitignore 忽略）
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const REMOTE = 'deploy';
const BRANCH = 'main';
process.chdir(ROOT);

// ---------------------------------------------------------------- 基础工具

function loadDeployEnv() {
  const file = path.join(ROOT, '.deploy.env');
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim().replace(/^["']|["']$/g, '');
    value = value.replace(/\$HOME/g, os.homedir()).replace(/%USERPROFILE%/g, os.homedir());
    env[m[1]] = value;
  }
  return env;
}

function run(command, { allowFail = false } = {}) {
  try {
    execSync(command, { cwd: ROOT, stdio: 'inherit', shell: true });
    return true;
  } catch (err) {
    if (allowFail) return false;
    const hint = err?.status === 128 ? '（git 命令失败）' : '';
    console.error(`\n命令失败${hint}: ${command}`);
    process.exit(1);
  }
}

/** 捕获命令输出：走临时文件重定向，避开受限制环境下无法创建管道的限制 */
function capture(command) {
  const tmp = path.join(os.tmpdir(), `foodsoul-${process.pid}-${Date.now()}.out`);
  const ok = run(`${command} > "${tmp}" 2>&1`, { allowFail: true });
  let text = '';
  try { text = fs.readFileSync(tmp, 'utf8'); } catch { /* ignore */ }
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  return { ok, text };
}

const deployEnv = loadDeployEnv();
const HOST = process.env.DEPLOY_HOST || deployEnv.DEPLOY_HOST || '';
const USER = process.env.DEPLOY_USER || deployEnv.DEPLOY_USER || 'root';
const PORT = process.env.DEPLOY_PORT || deployEnv.DEPLOY_PORT || '22';
const APP = process.env.DEPLOY_APP || deployEnv.DEPLOY_APP || '/opt/food-soul';
const KEY = process.env.DEPLOY_KEY || deployEnv.DEPLOY_KEY || path.join(os.homedir(), '.ssh', 'id_ed25519');

function requireConfig() {
  if (!HOST) {
    console.error('缺少服务器地址：请创建 .deploy.env（参考 .deploy.env.example）或设置 DEPLOY_HOST');
    process.exit(1);
  }
  if (!fs.existsSync(KEY)) {
    console.error(`缺少部署私钥：${KEY}`);
    process.exit(1);
  }
}

const SSH_BASE = () => `ssh -i "${KEY}" -p ${PORT} -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new ${USER}@${HOST}`;
const ssh = (remoteCommand) => `${SSH_BASE()} "${remoteCommand}"`;

/** 把本地脚本送到服务器再执行，避免远程命令里的引号地狱 */
function sshScript(localFile, args = '') {
  const remote = `/tmp/foodsoul-${Date.now()}-${path.basename(localFile)}`;
  const scp = `scp -q -i "${KEY}" -P ${PORT} -o StrictHostKeyChecking=accept-new "${localFile}" ${USER}@${HOST}:${remote}`;
  if (!run(scp, { allowFail: true })) {
    console.error(`上传脚本失败：${localFile}`);
    process.exit(1);
  }
  return run(ssh(`bash ${remote} ${args}`), { allowFail: true });
}

// ---------------------------------------------------------------- 状态读取

function readState() {
  const { ok, text } = capture(ssh(`cat ${APP}/.deploy/last.json`));
  if (!ok || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function printState(state) {
  if (!state) {
    console.log('\n[状态] 读取失败：服务器尚无部署记录（先执行 --bootstrap / 推一次代码）');
    return false;
  }
  const mark = (v) => (v === true ? '✓' : '✗');
  console.log('\n────────── 服务器部署状态 ──────────');
  console.log(`  版本      ${state.commit}  ${state.subject}`);
  console.log(`  时间      ${state.time}`);
  console.log(`  构建      ${mark(state.build_ok)}  重启 ${mark(state.restart_ok)}`);
  console.log(`  健康检查  ${state.health}`);
  console.log(`  GitHub    ${mark(state.github_ok)}  ${state.github_msg}`);
  console.log('────────────────────────────────────');
  return state.build_ok === true && state.health === '200';
}

// ---------------------------------------------------------------- 动作

function ensureRemote() {
  const url = `ssh://${USER}@${HOST}:${PORT}${APP}`;
  const current = capture(`git remote get-url ${REMOTE}`).text.trim();
  if (!current) {
    run(`git remote add ${REMOTE} ${url}`);
    console.log(`[配置] 已添加远程 ${REMOTE} → ${url}`);
  } else if (current !== url) {
    run(`git remote set-url ${REMOTE} ${url}`);
    console.log(`[配置] 已更新远程 ${REMOTE} → ${url}`);
  }
  const sshCommand = `ssh -i "${KEY}" -o BatchMode=yes -o StrictHostKeyChecking=accept-new`;
  const existing = capture('git config --local --get core.sshCommand').text.trim();
  if (!existing) {
    run(`git config --local core.sshCommand "${sshCommand}"`);
  }
}

function bootstrapServer() {
  requireConfig();
  console.log(`[初始化] 目标 ${USER}@${HOST}:${APP}`);
  const scriptPath = path.join(ROOT, 'scripts', 'server', 'bootstrap.sh');
  if (!sshScript(scriptPath)) {
    console.error('服务器初始化失败，请检查 SSH 权限与服务器 git 可用性');
    process.exit(1);
  }
  ensureRemote();
  console.log('\n[初始化] 完成。下一步：node scripts/ship.mjs --install-hook');
}

function installHook() {
  requireConfig();
  const scriptPath = path.join(ROOT, 'scripts', 'server', 'post-update.sh');
  const scp = `scp -q -i "${KEY}" -P ${PORT} "${scriptPath}" ${USER}@${HOST}:${APP}/scripts/server/post-update.sh`;
  if (!run(scp, { allowFail: true })) {
    console.error('上传钩子失败');
    process.exit(1);
  }
  const ok = run(
    ssh(`install -m 755 ${APP}/scripts/server/post-update.sh ${APP}/.git/hooks/post-update && echo "[钩子] 已安装"`),
    { allowFail: true },
  );
  if (!ok) {
    console.error('安装钩子失败');
    process.exit(1);
  }
}

function githubSetup() {
  requireConfig();
  const scriptPath = path.join(ROOT, 'scripts', 'server', 'github-setup.sh');
  if (!sshScript(scriptPath)) {
    console.error('生成 GitHub 部署密钥失败');
    process.exit(1);
  }
}

function showStatus() {
  requireConfig();
  const state = readState();
  const healthy = printState(state);
  process.exitCode = healthy ? 0 : 1;
}

function ship({ pushOnly, message }) {
  requireConfig();
  ensureRemote();

  run('git add -A');
  const pending = capture('git status --porcelain').text.trim();

  if (pending) {
    if (pushOnly) {
      console.error('\n[中止] 还有未提交的改动，请先提交（去掉 --push-only）或加 -m 提交说明');
      console.error(pending);
      process.exit(1);
    }
    if (!message) {
      console.error('\n[中止] 需要提交说明，例如： node scripts/ship.mjs -m "feat: 新增xxx"');
      process.exit(1);
    }
    run(`git commit -m "${message.replace(/"/g, '\\"')}"`);
  } else if (!message) {
    console.log('[提示] 没有新的本地改动，将直接发布当前 HEAD');
  }

  console.log('\n[发布] 推送到服务器（服务器将构建并重启）...\n');
  if (!run(`git push ${REMOTE} ${BRANCH}`, { allowFail: true })) {
    console.error('\n[失败] 推送失败，服务器未更新。请检查 SSH 连通性与服务器工作区是否干净');
    process.exit(1);
  }

  const state = readState();
  const healthy = printState(state);
  if (state) console.log(`\n  线上地址  http://${HOST}/`);
  process.exitCode = healthy ? 0 : 1;
}

// ---------------------------------------------------------------- 入口

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] || '' : '';
};

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(fs.readFileSync(path.join(ROOT, 'scripts', 'ship.mjs'), 'utf8').split('*/')[0]);
} else if (argv.includes('--bootstrap')) {
  bootstrapServer();
} else if (argv.includes('--install-hook')) {
  installHook();
} else if (argv.includes('--github-setup')) {
  githubSetup();
} else if (argv.includes('--status')) {
  showStatus();
} else if (argv.includes('--push-only')) {
  ship({ pushOnly: true, message: flag('-m') || flag('--message') || '' });
} else {
  ship({ pushOnly: false, message: flag('-m') || flag('--message') || '' });
}