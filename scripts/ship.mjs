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
 * 传输方式：默认走「git bundle + scp」，任何环境都能跑（不依赖本机 git 的 ssh 调用）；
 *          加 --via=git 可改用 git push deploy main（本机凭据/网络正常时更省事）。
 *
 * 配置来源：.deploy.env（已被 .gitignore 忽略）
 */

import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const REMOTE = 'deploy';
const BRANCH = 'main';
const BUNDLE_REMOTE = '/tmp/food-soul-ship.bundle';
process.chdir(ROOT);

const USAGE = `用法：
  node scripts/ship.mjs -m "feat: 说明"   提交本地改动并发布（服务器构建重启 + 同步 GitHub）
  node scripts/ship.mjs --push-only       不提交，直接发布当前 HEAD
  node scripts/ship.mjs --status          查看服务器上一次部署结果
  node scripts/ship.mjs --install-hook    安装/更新服务器部署钩子
  node scripts/ship.mjs --bootstrap       首次接管服务器（建 git 仓库 + 装钩子，幂等）
  node scripts/ship.mjs --github-setup    生成 GitHub 部署密钥并打印公钥

可选：--via=git 改用 git push 传输（默认 bundle + scp，兼容任何环境）`;

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
  } catch {
    if (allowFail) return false;
    console.error(`\n命令失败: ${command}`);
    process.exit(1);
  }
}

/** 捕获命令输出：走临时文件重定向，避开受限环境无法创建管道的限制 */
function capture(command) {
  const tmp = path.join(os.tmpdir(), `foodsoul-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.out`);
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

const ssh = (remoteCommand) =>
  `ssh -i "${KEY}" -p ${PORT} -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new ${USER}@${HOST} "${remoteCommand}"`;

/** 把本地脚本送到服务器再执行，避免远程命令里的引号地狱 */
function sshScript(localFile) {
  const remote = `/tmp/foodsoul-${path.basename(localFile)}`;
  if (!run(`scp -q -i "${KEY}" -P ${PORT} "${localFile}" ${USER}@${HOST}:${remote}`, { allowFail: true })) {
    console.error(`上传脚本失败：${localFile}`);
    process.exit(1);
  }
  return run(ssh(`bash ${remote}`), { allowFail: true });
}

// ---------------------------------------------------------------- 状态

function readState() {
  const { ok, text } = capture(ssh(`cat ${APP}/.deploy/last.json`));
  if (!ok || !text.trim()) return null;
  try {
    return JSON.parse(text.slice(text.indexOf('{')));
  } catch {
    return null;
  }
}

function printState(state) {
  if (!state) {
    console.log('\n[状态] 服务器尚无部署记录（先执行 --bootstrap，或发布一次）');
    return { healthy: false, known: false };
  }
  const mark = (v) => (v === true ? '✓' : '✗');
  console.log('\n────────── 服务器部署状态 ──────────');
  console.log(`  版本      ${state.commit}  ${state.subject}`);
  console.log(`  时间      ${state.time}`);
  console.log(`  构建      ${mark(state.build_ok)}   重启 ${mark(state.restart_ok)}`);
  console.log(`  健康检查  ${state.health}`);
  console.log(`  GitHub    ${mark(state.github_ok)}  ${state.github_msg}`);
  console.log('────────────────────────────────────');
  return { healthy: state.build_ok === true && state.health === '200', known: true };
}

// ---------------------------------------------------------------- 动作

function ensureRemote() {
  const url = `ssh://${USER}@${HOST}:${PORT}${APP}`;
  const current = capture(`git remote get-url ${REMOTE}`).text.trim();
  if (!current) {
    run(`git remote add ${REMOTE} ${url}`, { allowFail: true });
  } else if (current !== url) {
    run(`git remote set-url ${REMOTE} ${url}`, { allowFail: true });
  }
  const sshCommand = `ssh -i "${KEY}" -o BatchMode=yes -o StrictHostKeyChecking=accept-new`;
  if (!capture('git config --local --get core.sshCommand').text.trim()) {
    run(`git config --local core.sshCommand "${sshCommand}"`, { allowFail: true });
  }
}

function installHook() {
  requireConfig();
  const local = path.join(ROOT, 'scripts', 'server', 'post-update.sh');
  const tmp = '/tmp/food-soul-post-update.sh';
  if (!run(`scp -q -i "${KEY}" -P ${PORT} "${local}" ${USER}@${HOST}:${tmp}`, { allowFail: true })) {
    console.error('上传钩子失败');
    process.exit(1);
  }
  const ok = run(
    ssh(`install -D -m 755 ${tmp} ${APP}/.git/hooks/post-update && rm -f ${tmp}`),
    { allowFail: true },
  );
  if (!ok) {
    console.error('安装钩子失败');
    process.exit(1);
  }
  console.log('[钩子] 已安装到服务器 .git/hooks/post-update');
}

/** 钩子与本地不一致时自动重装，避免改了钩子却忘了同步 */
function syncHookIfNeeded() {
  const local = path.join(ROOT, 'scripts', 'server', 'post-update.sh');
  if (!fs.existsSync(local)) return;
  const localSha = crypto.createHash('sha256').update(fs.readFileSync(local)).digest('hex');
  const { text } = capture(ssh(`sha256sum ${APP}/.git/hooks/post-update 2>/dev/null`));
  if (!text.trim().startsWith(localSha)) installHook();
}

function bootstrapServer() {
  requireConfig();
  console.log(`[初始化] 目标 ${USER}@${HOST}:${APP}`);
  if (!sshScript(path.join(ROOT, 'scripts', 'server', 'bootstrap.sh'))) {
    console.error('服务器初始化失败，请检查 SSH 权限与服务器 git 可用性');
    process.exit(1);
  }
  ensureRemote();
  installHook();
}

function githubSetup() {
  requireConfig();
  if (!sshScript(path.join(ROOT, 'scripts', 'server', 'github-setup.sh'))) {
    console.error('生成 GitHub 部署密钥失败');
    process.exit(1);
  }
}

function showStatus() {
  requireConfig();
  const { healthy, known } = printState(readState());
  if (known) console.log(`\n  线上地址  http://${HOST}/`);
  process.exitCode = healthy ? 0 : 1;
}

function serverHead() {
  const { text } = capture(ssh(`cd ${APP} && git rev-parse HEAD`));
  const sha = text.trim().split(/\s+/).pop() || '';
  return /^[0-9a-f]{40}$/.test(sha) ? sha : '';
}

function deployViaBundle() {
  const remote = serverHead();
  const local = capture('git rev-parse HEAD').text.trim();
  if (!remote) {
    console.error('\n[失败] 读不到服务器版本，先执行 node scripts/ship.mjs --bootstrap');
    process.exit(1);
  }
  if (remote === local) {
    console.log('[发布] 服务器已是最新版本，无需传输');
    return;
  }

  const bundle = path.join(os.tmpdir(), `food-soul-${Date.now()}.bundle`);
  let created = run(`git bundle create "${bundle}" ${BRANCH} --not ${remote}`, { allowFail: true });
  if (!created) {
    console.log('[发布] 服务器版本不在本地历史中，改用全量 bundle');
    run(`git bundle create "${bundle}" ${BRANCH}`);
  }
  console.log(`[发布] bundle ${Math.round(fs.statSync(bundle).size / 1024)} KB`);

  const up = run(`scp -q -i "${KEY}" -P ${PORT} "${bundle}" ${USER}@${HOST}:${BUNDLE_REMOTE}`, { allowFail: true });
  fs.rmSync(bundle, { force: true });
  if (!up) {
    console.error('[失败] 上传 bundle 失败');
    process.exit(1);
  }

  const apply =
    `cd ${APP} && ` +
    `git bundle verify ${BUNDLE_REMOTE} >/dev/null 2>&1 && ` +
    `git fetch -q --no-tags ${BUNDLE_REMOTE} ${BRANCH}:refs/ship/incoming && ` +
    `git merge -q --ff-only refs/ship/incoming && ` +
    `git update-ref -d refs/ship/incoming && ` +
    `rm -f ${BUNDLE_REMOTE} && ` +
    `bash .git/hooks/post-update`;
  if (!run(ssh(apply), { allowFail: true })) {
    console.error('\n[失败] 服务器应用更新失败（详见服务器 .deploy/deploy.log）');
    process.exit(1);
  }
}

function deployViaGit() {
  ensureRemote();
  console.log('[发布] git push 到服务器...');
  if (!run(`git push ${REMOTE} ${BRANCH}`, { allowFail: true })) {
    console.error('\n[失败] git push 失败，可改用默认方式：node scripts/ship.mjs --push-only');
    process.exit(1);
  }
}

function ship({ pushOnly, message, via }) {
  requireConfig();
  run('git add -A');
  const pending = capture('git status --porcelain').text.trim();

  if (pending) {
    if (pushOnly) {
      console.error('\n[中止] 还有未提交的改动，请先提交（或去掉 --push-only）');
      console.error(pending);
      process.exit(1);
    }
    if (!message) {
      console.error('\n[中止] 需要提交说明，例如： node scripts/ship.mjs -m "feat: 新增xxx"');
      process.exit(1);
    }
    run(`git commit -m "${message.replace(/"/g, '\\"')}"`);
  } else if (!message) {
    console.log('[提示] 没有新的本地改动，直接发布当前 HEAD');
  }

  syncHookIfNeeded();

  console.log('\n[发布] 传输代码到服务器（服务器将构建并重启）...');
  if (via === 'git') deployViaGit();
  else deployViaBundle();

  const { healthy, known } = printState(readState());
  if (known) console.log(`\n  线上地址  http://${HOST}/`);
  process.exitCode = healthy ? 0 : 1;
}

// ---------------------------------------------------------------- 入口

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] || '' : '';
};
const via = (flag('--via') || 'bundle').trim();

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(USAGE);
} else if (argv.includes('--bootstrap')) {
  bootstrapServer();
} else if (argv.includes('--install-hook')) {
  installHook();
} else if (argv.includes('--github-setup')) {
  githubSetup();
} else if (argv.includes('--status')) {
  showStatus();
} else if (argv.includes('--push-only')) {
  ship({ pushOnly: true, message: flag('-m') || flag('--message') || '', via });
} else {
  ship({ pushOnly: false, message: flag('-m') || flag('--message') || '', via });
}