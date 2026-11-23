/**
 * 联网检索诊断：自建 SearXNG → 360 搜索 → Bing RSS。
 *
 * 只发一次真实检索请求，输出实际端点、HTTP 状态、结果数、来源站点、
 * 耗时与判定。不涉及任何模型 Key，也不需要登录。
 *
 * 用法：
 *   node scripts/diagnose-search.mjs            # 读取 .env 并发一次请求
 *   node scripts/diagnose-search.mjs --no-probe # 只看配置，不发请求
 */
import { getSearchConfig, isSearchConfigured, searchConfigNeeded } from '../server/config.mjs';
import { webSearch } from '../server/web-search.mjs';

const noProbe = process.argv.includes('--no-probe');
const cfg = getSearchConfig();
const needed = searchConfigNeeded();

console.log('=== 联网检索配置（自建 SearXNG / 360 / Bing）===');
console.log(`SearXNG : ${cfg.searxngUrl || '(未配置，跳过该来源)'}`);
console.log(`360     : ${cfg.so360Url || '(未配置，关闭该来源)'}`);
console.log(`Bing RSS: ${cfg.bingRssUrl || '(未配置，关闭该来源)'}`);
console.log('');
console.log(`配置判定: ${isSearchConfigured() ? '至少一个来源可用' : '三个来源都为空'}`);
if (needed.length) console.log(`仍为空的变量: ${needed.join(', ')}`);

if (!isSearchConfigured()) {
  console.log('结论：没有配置任何外部检索来源；图鉴外内容会明确提示，不会伪造来源。');
  process.exit(2);
}
if (noProbe) {
  console.log('（--no-probe：未发起真实请求）');
  process.exit(0);
}

const started = Date.now();
const r = await webSearch('馒头 做法 食材', { count: 5, timeout: 12000 });
const sites = [...new Set((r.sources || []).map((s) => s.site).filter(Boolean))];

console.log('');
console.log('=== 结果 ===');
console.log(`状态     : ${r.status}${r.errorKind ? ` (${r.errorKind})` : ''}`);
console.log(`结果数   : ${(r.sources || []).length}`);
console.log(`来源站点 : ${sites.join(', ') || '(无)'}`);
console.log(`耗时     : ${Date.now() - started} ms`);
if (r.message) console.log(`说明     : ${r.message}`);
console.log('');

if (r.status === 'ok' || r.status === 'empty') {
  console.log('判定     : 检索链路可用');
  if (r.status === 'empty') console.log('建议     : 链路通但这次没结果，可稍后重试或给自建 SearXNG 增加可用引擎。');
  process.exit(0);
}

console.log('判定     : 检索链路不可用');
console.log('建议     : 检查服务器能否访问 www.so.com / cn.bing.com；若配置了 SearXNG，检查实例、limiter 与反向代理。');
process.exit(1);