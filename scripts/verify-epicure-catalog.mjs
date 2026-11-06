/**
 * 校验目录里每个食材能否被 Epicure MCP 真正解析
 *
 * 背景：官方目录（网页搜索索引）和 MCP 的嵌入词表偶有拼写差异，
 * 例如目录叫 szechuan peppercorn，MCP 只认 sichuan_peppercorn。
 * 因此「目录里有」不等于「能算风味」，这里逐条实测并把结果写回 mcp_ok。
 *
 * 用法：
 *   node scripts/verify-epicure-catalog.mjs            # 只测未验证的
 *   node scripts/verify-epicure-catalog.mjs --all      # 全部重测
 *   node scripts/verify-epicure-catalog.mjs --limit 100
 */
import { db } from '../server/db.mjs';
import { callTool } from '../server/epicure-client.mjs';

const ALL = process.argv.includes('--all');
const limitArg = process.argv.find((a) => a.startsWith('--limit'));
const LIMIT = limitArg ? Number(limitArg.split('=')[1] || limitArg.split(' ')[1]) || 0 : 0;
const CONCURRENCY = 2;
const RETRY_429 = 3;

const where = ALL ? 'active = 1' : 'active = 1 AND mcp_ok IS NULL';
const rows = db.prepare(`SELECT name, cn FROM epicure_catalog WHERE ${where} ORDER BY original_count DESC`).all();
const list = LIMIT ? rows.slice(0, LIMIT) : rows;
console.log(`待验证 ${list.length} 条（共 ${rows.length} 条候选），并发 ${CONCURRENCY}`);

const update = db.prepare('UPDATE epicure_catalog SET mcp_ok = ? WHERE name = ?');
let ok = 0;
let bad = 0;
let unknown = 0;
let i = 0;
const failures = [];
const started = Date.now();

async function worker() {
  while (i < list.length) {
    const item = list[i++];
    let r = await callTool('neighbors', { ingredient: item.name, top_k: 1 }, { timeout: 12000, noCache: true });
    // 429 / 网络类错误不算「不可解析」，退避重试
    for (let attempt = 0; attempt < RETRY_429 && !r.ok && /429|timeout|network|ECONN/i.test(String(r.error || '')); attempt += 1) {
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
      r = await callTool('neighbors', { ingredient: item.name, top_k: 1 }, { timeout: 12000, noCache: true });
    }
    if (r.ok) {
      ok += 1;
      update.run(1, item.name);
    } else if (/Could not resolve|not found|unknown/i.test(String(r.error || ''))) {
      bad += 1;
      update.run(0, item.name);
      failures.push(`${item.cn || item.name}(${item.name})`);
    } else {
      unknown += 1; // 限流/超时：保留 NULL，下次再验
    }
    if ((ok + bad + unknown) % 100 === 0) {
      console.log(`  进度 ${ok + bad}/${list.length} · 成功 ${ok} 失败 ${bad} · ${Math.round((Date.now() - started) / 1000)}s`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(`\n完成：可解析 ${ok}，不可解析 ${bad}，未判定 ${unknown}，耗时 ${Math.round((Date.now() - started) / 1000)}s`);
if (failures.length) {
  console.log('\n不可解析示例（前 30 条）：');
  console.log(failures.slice(0, 30).join('\n'));
}
const stat = db
  .prepare('SELECT SUM(mcp_ok = 1) AS yes, SUM(mcp_ok = 0) AS no, SUM(mcp_ok IS NULL) AS unknown FROM epicure_catalog WHERE active = 1')
  .get();
console.log('\n目录状态：可分析', stat.yes || 0, '· 不可解析', stat.no || 0, '· 未验证', stat.unknown || 0);
process.exit(0);
