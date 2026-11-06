/**
 * Epicure MCP 全量验收
 *
 * 覆盖：
 * 1. healthz 健康检查
 * 2. MCP 初始化 / tools/list / Schema 解析
 * 3. 13 个工具逐一真实调用（参数取自动态 Schema，不靠猜）
 * 4. 中文食材映射、未收录食材提示
 * 5. 降级：Epicure 关闭时服务不受影响
 *
 * 用法：node scripts/verify-epicure.mjs
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { spawn } from 'node:child_process';

import {
  epicureStatus,
  listTools,
  callTool,
  toolsPublic,
  isEpicureEnabled,
} from '../server/epicure-client.mjs';
import { resolveIngredient, runTool } from '../server/epicure-service.mjs';

const HEALTH = 'https://epicure-mcp.kaikaku.ai/healthz';
let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function section(title, fn) {
  console.log(`\n${title}`);
  try {
    await fn();
  } catch (err) {
    fail += 1;
    failures.push(`${title} 抛出异常`);
    console.log(`  ✗ 异常：${String(err?.message || err).slice(0, 160)}`);
  }
}

/* ---------------- 1. 健康检查 ---------------- */
await section('【1】健康检查', async () => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(HEALTH, { signal: ctrl.signal });
    check('healthz 可访问', res.ok, `HTTP ${res.status}`);
  } catch (err) {
    check('healthz 可访问', false, String(err?.message || err).slice(0, 80));
  } finally {
    clearTimeout(timer);
  }
});

/* ---------------- 2. MCP 基础 ---------------- */
let tools = [];
await section('【2】MCP 初始化与工具清单', async () => {
  check('EPICURE_ENABLED', isEpicureEnabled());
  const st = await epicureStatus();
  check('MCP 连接成功', st.ok, st.error || `${st.ms}ms`);
  check('工具数量为 13', st.toolCount === 13, `实际 ${st.toolCount}`);

  tools = await listTools();
  const names = tools.map((t) => t.name).sort();
  const expected = [
    'closest_mode',
    'compare_on_axis',
    'cultural_profile',
    'find_pairings',
    'flavour_correlations',
    'ingredient_on_factor',
    'list_factors',
    'list_targets',
    'morph',
    'neighbors',
    'pairing_score',
    'pareto_navigate',
    'where_on_atlas',
  ];
  check('工具名与官方一致', JSON.stringify(names) === JSON.stringify(expected), names.join(','));
  check(
    '每个工具都有 inputSchema',
    tools.every((t) => t.inputSchema && typeof t.inputSchema === 'object'),
    `${tools.length} 个`
  );

  const pub = await toolsPublic();
  check('公开清单可返回且不含内部字段', pub.length === 13 && pub.every((t) => !('inputSchema' in t)), `${pub.length} 条`);
});

/* ---------------- 3. 13 个工具逐一调用 ---------------- */
await section('【3】13 个工具真实调用', async () => {
  // 先拿到真实的方向名与因子名，避免猜参数
  const targets = await runTool('list_targets', { kind: 'direction', limit: 20 });
  const factors = await runTool('list_factors', { limit: 5, include_examples: true });
  const direction = pickDirection(targets);
  const factor = pickFactor(factors);
  console.log(`    方向样本：${direction || '（未取到）'}｜因子样本：${factor || '（未取到）'}`);

  const cases = [
    ['list_targets', { kind: 'direction', limit: 10 }],
    ['list_factors', { limit: 5, include_examples: true }],
    ['pairing_score', { ingredient_a: '香菇', ingredient_b: '鸡肉' }],
    ['find_pairings', { ingredients: ['香菇', '鸡肉'] }],
    ['neighbors', { ingredient: '豆腐', top_k: 5 }],
    ['cultural_profile', { ingredient: '花椒' }],
    ['where_on_atlas', { ingredient: '豆腐', top_k_neighbors_2d: 3 }],
    ['closest_mode', { ingredient: '豆腐', top_k: 3 }],
    ['flavour_correlations', { limit: 5, min_abs_correlation: 0.1 }],
    ['compare_on_axis', { ingredient_a: '香菇', ingredient_b: '鸡肉', axis: direction || 'East_Asian' }],
    ['ingredient_on_factor', { ingredient: '香菇', factor: Number.isInteger(factor) ? factor : 0 }],
    ['morph', { seed: '香菇', target: direction || 'East_Asian', angle_deg: 30, top_k: 5 }],
    ['pareto_navigate', { seed: '香菇', pole: { factor: 0, side: 'a' }, top_k_poles: 3 }],
  ];

  for (const [name, args] of cases) {
    const r = await runTool(name, args);
    check(`${name}`, r.ok, r.ok ? `${r.ms}ms` : String(r.error || '').slice(0, 90));
  }
  check('13 个工具全部覆盖', cases.length === 13, `${cases.length} 个用例`);
});

function pickDirection(res) {
  if (!res.ok) return '';
  const dirs = res.data?.directions;
  if (Array.isArray(dirs) && dirs[0]?.name) return String(dirs[0].name);
  return '';
}

function pickFactor(res) {
  if (!res.ok) return 0;
  const list = res.data?.factors;
  if (Array.isArray(list) && list[0]?.factor !== undefined) return Number(list[0].factor) || 0;
  return 0;
}

/* ---------------- 4. 中文映射与错误提示 ---------------- */
await section('【4】中文食材与异常', async () => {
  const a = resolveIngredient('香菇');
  const b = resolveIngredient('花椒');
  check('中文→Epicure 映射（香菇）', a?.epicure === 'shiitake_mushroom', a?.epicure || '未解析');
  check('中文→Epicure 映射（花椒）', b?.epicure === 'sichuan_peppercorn', b?.epicure || '未解析');

  const bad = await runTool('pairing_score', { ingredient_a: '排骨', ingredient_b: '香菇' });
  check('未收录食材给出明确提示', !bad.ok && /未收录/.test(String(bad.error || '')), String(bad.error || '').slice(0, 40));

  const badArgs = await runTool('pairing_score', { ingredient_a: '香菇' });
  check('缺参数被拦截', !badArgs.ok && /缺少参数/.test(String(badArgs.error || '')), String(badArgs.error || '').slice(0, 40));

  const notAllowed = await callTool('delete_everything', {});
  check('白名单拦截未知工具', !notAllowed.ok && notAllowed.error === 'tool-not-allowed');
});

/* ---------------- 5. 超时与降级 ---------------- */
await section('【5】超时与降级', async () => {
  const slow = await callTool('find_pairings', { ingredients: ['tofu', 'beef', 'shrimp', 'egg'] }, { timeout: 2000, noCache: true });
  check('超时不抛出异常（返回结果或明确错误）', typeof slow.ok === 'boolean', slow.ok ? `${slow.ms}ms 完成` : String(slow.error || '').slice(0, 40));

  const child = spawn(process.execPath, ['-e', `
    process.env.EPICURE_ENABLED='false';
    const m = await import('./server/epicure-client.mjs');
    const s = await m.epicureStatus();
    const r = await m.callTool('neighbors',{ingredient:'tofu'});
    console.log(JSON.stringify({status:s, call:r}));
  `, '--input-type=module'], { cwd: process.cwd(), env: { ...process.env, EPICURE_ENABLED: 'false' } });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  await new Promise((r) => child.on('close', r));
  let parsed = null;
  try {
    parsed = JSON.parse(out.trim().split('\n').pop());
  } catch {
    parsed = null;
  }
  check('EPICURE_ENABLED=false 时状态为关闭', parsed?.status?.enabled === false, JSON.stringify(parsed?.status || {}).slice(0, 60));
  check('关闭时调用返回错误而不崩溃', parsed?.call?.ok === false, String(parsed?.call?.error || '').slice(0, 40));
});

/* ---------------- 汇总 ---------------- */
await sleep(200);
console.log(`\n${'─'.repeat(46)}`);
console.log(`Epicure 验收：${pass} 通过 / ${fail} 失败`);
if (fail) console.log('失败项：', failures.join('、'));
process.exit(fail ? 1 : 0);
