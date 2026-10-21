/**
 * 联网检索配置与连通性诊断。
 *
 * 支持两种 provider：
 *   SEARCH_PROVIDER=zhipu   智谱 Web Search（付费，需 SEARCH_API_KEY）
 *   SEARCH_PROVIDER=searxng 自建 SearXNG（免费，需 SEARXNG_URL）
 *
 * 安全：密钥只以 sha256 前 8 位「指纹」出现，绝不输出原文。
 *
 * 用法：
 *   node scripts/diagnose-search.mjs            # 读取 .env
 *   node scripts/diagnose-search.mjs --no-probe # 只看配置，不发请求
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const envFile = path.join(ROOT, '.env');
const env = {};
if (fs.existsSync(envFile)) {
  // 注意：.env 是 CRLF，直接 split('\n') 会留下尾部 \r，导致 /^KEY=value$/ 匹配失败
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
}

const pick = (k) => process.env[k] || env[k] || '';
const provider = (pick('SEARCH_PROVIDER') || 'zhipu').toLowerCase();
const apiKey = pick('SEARCH_API_KEY');
const baseUrl = (pick('SEARCH_BASE_URL') || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, '');
const searxngUrl = (pick('SEARXNG_URL') || '').replace(/\/$/, '');
const noProbe = process.argv.includes('--no-probe');

const fingerprint = apiKey ? crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 8) : 'none';

function hostOf(u) {
  try {
    return new URL(u).host;
  } catch {
    return '(invalid)';
  }
}

console.log('=== 联网检索配置 ===');
console.log(`provider      : ${provider}`);
if (provider === 'searxng') {
  console.log(`实例地址      : ${searxngUrl || '(未配置)'}`);
  console.log(`主机          : ${hostOf(searxngUrl)}`);
  console.log(`鉴权          : 无（自建实例，仅监听 127.0.0.1）`);
} else {
  console.log(`服务商        : 智谱 AI（Web Search API）`);
  console.log(`端点          : ${baseUrl}/web_search`);
  console.log(`主机          : ${hostOf(baseUrl)}`);
  console.log(`SEARCH_API_KEY: ${apiKey ? `已配置（长度 ${apiKey.length}，指纹 ${fingerprint}）` : '未配置'}`);
  console.log(`Key 形态      : ${apiKey.includes('.') ? '含「.」，符合智谱 id.secret 格式' : '不含「.」，不像智谱 Key'}`);
}
console.log('');

if (noProbe) {
  console.log('（--no-probe：未发起真实请求）');
  process.exit(0);
}

const started = Date.now();
let res;
let probeUrl;
if (provider === 'searxng') {
  if (!searxngUrl) {
    console.log('结论：没有配置 SEARXNG_URL，图鉴外菜品只能走「模型已有知识」。');
    process.exit(2);
  }
  probeUrl = `${searxngUrl}/search?q=${encodeURIComponent('馒头 做法 食材')}&format=json&language=zh-CN&safesearch=0&categories=general`;
  try {
    res = await fetch(probeUrl, { headers: { accept: 'application/json' } });
  } catch (err) {
    console.log('=== 结果 ===');
    console.log(`传输层失败: ${err?.message || err}${err?.cause?.code ? `（${err.cause.code}）` : ''}`);
    console.log('结论：连不上自建实例，检查容器：docker ps | grep searxng');
    process.exit(1);
  }
} else {
  if (!apiKey) {
    console.log('结论：没有配置 SEARCH_API_KEY，图鉴外菜品只能走「模型已有知识」。');
    process.exit(2);
  }
  probeUrl = `${baseUrl}/web_search`;
  try {
    res = await fetch(probeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ search_engine: 'search_std', search_query: '馒头 做法 食材', count: 1 }),
    });
  } catch (err) {
    console.log('=== 结果 ===');
    console.log(`传输层失败: ${err?.message || err}${err?.cause?.code ? `（${err.cause.code}）` : ''}`);
    console.log('结论：网络不通或被拦截，检查服务器出网与 DNS。');
    process.exit(1);
  }
}

const text = await res.text();
let body = {};
try {
  body = JSON.parse(text);
} catch {
  body = {};
}
const elapsed = Date.now() - started;

console.log('=== 结果 ===');
console.log(`HTTP 状态     : ${res.status}`);

if (provider === 'searxng') {
  const results = Array.isArray(body?.results) ? body.results : [];
  const engines = [...new Set(results.map((r) => r.engine).filter(Boolean))];
  const down = Array.isArray(body?.unresponsive_engines) ? body.unresponsive_engines : [];
  console.log(`结果数        : ${results.length}`);
  console.log(`命中引擎      : ${engines.join(', ') || '(无)'}`);
  console.log(`不可用引擎    : ${down.map((d) => `${d[0]}:${d[1]}`).join(', ') || '(无)'}`);
  console.log(`耗时          : ${elapsed} ms`);
  console.log('');

  let verdict;
  let action;
  if (!res.ok) {
    verdict = res.status === 429 ? 'rate_limit' : res.status === 403 ? 'auth' : res.status >= 500 ? 'server' : 'failed';
    action =
      verdict === 'auth'
        ? '实例开了 limiter 或反爬：把 /opt/searxng/settings.yml 里 server.limiter 设为 false 后重启容器。'
        : '查看容器日志：docker logs --tail 50 searxng';
  } else if (results.length === 0) {
    verdict = 'empty';
    action = '实例可用但没有结果：检查 settings.yml 启用的引擎，或换关键词再试。';
  } else {
    verdict = 'ok';
    action = '检索可用。若页面仍显示「模型知识」，确认服务端 .env 已设 SEARCH_PROVIDER=searxng 并重启。';
  }
  console.log(`判定          : ${verdict}`);
  console.log(`建议          : ${action}`);
  process.exit(verdict === 'ok' ? 0 : 1);
}

const code = String(body?.error?.code ?? '');
const message = String(body?.error?.message ?? '');
console.log(`服务商错误码  : ${code || '(无)'}`);
console.log(`服务商消息    : ${message || (text.startsWith('{') ? '(无)' : '(非 JSON 响应，未展示内容)')}`);
console.log(`耗时          : ${elapsed} ms`);
console.log('');

const QUOTA_CODES = new Set(['1113', '1114']);
const AUTH_CODES = new Set(['1000', '1001', '1002', '1003', '1004']);
let verdict;
let action;
if (res.ok) {
  verdict = 'ok';
  action = '检索可用。若页面仍报错，检查 SEARCH_BASE_URL 是否与 Key 所属环境一致。';
} else if (QUOTA_CODES.has(code) || /余额|资源包|充值|配额|额度/.test(message)) {
  verdict = 'quota';
  action = '账户余额或 Web Search 资源包不足：充值/买包，或改用 SEARCH_PROVIDER=searxng 走自建实例（免费）。';
} else if (AUTH_CODES.has(code) || res.status === 401 || res.status === 403) {
  verdict = 'auth';
  action = '这把 Key 本身无效：到智谱开放平台「API Keys」重新生成，替换 .env 的 SEARCH_API_KEY 后重启。';
} else if (res.status === 404) {
  verdict = 'not_found';
  action = '接口地址不对：确认 SEARCH_BASE_URL 为 https://open.bigmodel.cn/api/paas/v4。';
} else if (res.status === 429) {
  verdict = 'rate_limit';
  action = '触发频率限制，稍后重试即可；持续出现说明并发过高。';
} else if (res.status >= 500) {
  verdict = 'server';
  action = '服务商侧异常，稍后重试。';
} else {
  verdict = 'unknown';
  action = '未知错误，请把上面的状态码与错误码提供给服务商支持。';
}

console.log(`判定          : ${verdict}`);
console.log(`建议          : ${action}`);
process.exit(verdict === 'ok' ? 0 : 1);
