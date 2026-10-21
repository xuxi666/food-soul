/**
 * 联网检索（自建 SearXNG）诊断。
 *
 * 只发一次真实请求，输出：实例地址、HTTP 状态、结果数、命中引擎、
 * 不可用引擎、耗时、判定与建议。不涉及任何密钥。
 *
 * 用法：
 *   node scripts/diagnose-search.mjs            # 读取 .env
 *   node scripts/diagnose-search.mjs --no-probe # 只看配置
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const envFile = path.join(ROOT, '.env');
const env = {};
if (fs.existsSync(envFile)) {
  // .env 是 CRLF，split('\n') 会留下尾部 \r，导致 /^KEY=(.*)$/ 匹配失败
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
}

const pick = (k) => process.env[k] || env[k] || '';
const base = (pick('SEARXNG_URL') || '').replace(/\/$/, '');
const noProbe = process.argv.includes('--no-probe');

console.log('=== 联网检索配置（自建 SearXNG）===');
console.log(`实例地址 : ${base || '(未配置 SEARXNG_URL)'}`);
try {
  console.log(`主机     : ${new URL(base).host}`);
} catch {
  console.log('主机     : (无效)');
}
console.log('');

if (!base) {
  console.log('结论：没有配置 SEARXNG_URL，图鉴外菜品只能走「模型已有知识」。');
  process.exit(2);
}
if (noProbe) {
  console.log('（--no-probe：未发起真实请求）');
  process.exit(0);
}

const url = `${base}/search?q=${encodeURIComponent('馒头 做法 食材')}&format=json&language=zh-CN&safesearch=0&categories=general`;
const started = Date.now();
let res;
try {
  res = await fetch(url, { headers: { accept: 'application/json' } });
} catch (err) {
  console.log('=== 结果 ===');
  console.log(`传输层失败 : ${err?.message || err}${err?.cause?.code ? `（${err.cause.code}）` : ''}`);
  console.log('建议       : 容器是否在跑 → docker ps | grep searxng；端口是否监听 → ss -lntp | grep 8080');
  process.exit(1);
}

const text = await res.text();
let body = {};
try {
  body = JSON.parse(text);
} catch {
  body = {};
}
const results = Array.isArray(body?.results) ? body.results : [];
const engines = [...new Set(results.map((r) => r.engine).filter(Boolean))];
const down = Array.isArray(body?.unresponsive_engines) ? body.unresponsive_engines : [];

console.log('=== 结果 ===');
console.log(`HTTP 状态   : ${res.status}`);
console.log(`结果数      : ${results.length}`);
console.log(`命中引擎    : ${engines.join(', ') || '(无)'}`);
console.log(`不可用引擎  : ${down.map((d) => `${d[0]}:${d[1]}`).join(', ') || '(无)'}`);
console.log(`耗时        : ${Date.now() - started} ms`);
console.log('');

let verdict;
let action;
if (!res.ok) {
  verdict = res.status === 429 ? 'rate_limit' : res.status === 403 ? 'auth' : res.status >= 500 ? 'server' : 'failed';
  action =
    verdict === 'auth'
      ? '实例开了 limiter：把 /opt/searxng/settings.yml 的 server.limiter 设为 false 后 docker restart searxng。'
      : '看容器日志：docker logs --tail 50 searxng';
} else if (results.length === 0) {
  verdict = 'empty';
  action =
    '实例可用但没结果：多为搜索引擎对机房 IP 限流。docker restart searxng 可临时恢复；长期建议加一个可用的搜索引擎或换 API 型检索。';
} else {
  verdict = 'ok';
  action = '检索可用。页面若仍显示「模型知识」，说明该菜名确实没搜到相关结果。';
}

console.log(`判定        : ${verdict}`);
console.log(`建议        : ${action}`);
process.exit(verdict === 'ok' ? 0 : 1);
