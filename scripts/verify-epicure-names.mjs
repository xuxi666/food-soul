/**
 * 食材名称中文化验收
 *
 * 检查点：
 * 1. 已知 MCP 专属名能解析成中文（yu_choy / fried_tofu_puff / hot_pot_base）
 * 2. 目录内食材优先用目录中文名
 * 3. 无法识别的名字不瞎翻，返回可读英文并标记 translated=false
 * 4. 图谱邻居节点全部有中文显示（抽样多个中心食材）
 * 5. 传给 Epicure 的原始名不被改写
 */
import { resolveDisplay } from '../server/epicure-names.mjs';
import { buildNetwork, resolveIngredient } from '../server/epicure-service.mjs';

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

console.log('\n【1】MCP 专属名映射');
for (const [name, expect] of [
  ['yu_choy', '油菜'],
  ['fried_tofu_puff', '油豆腐泡'],
  ['hot_pot_base', '火锅底料'],
  ['light_soy_sauce', '生抽'],
  ['glass_noodle', '粉丝'],
]) {
  const r = resolveDisplay(name);
  check(`${name} → ${expect}`, r.display === expect, r.display);
}

console.log('\n【2】目录内食材');
for (const [name, expect] of [
  ['shiitake mushroom', '香菇'],
  ['tofu', '豆腐'],
  ['chinese napa cabbage', '大白菜'],
]) {
  const r = resolveDisplay(name);
  check(`${name} → ${expect}`, r.display === expect, r.display);
}

console.log('\n【3】未知名不瞎翻');
const unknown = resolveDisplay('totally_unknown_xyz');
check('标记为未翻译', unknown.translated === false, unknown.display);
check('不做中文猜测', !/[\u4e00-\u9fa5]/.test(unknown.display), unknown.display);

console.log('\n【4】原始名不被改写');
const ing = resolveIngredient('yu_choy');
check('resolveIngredient 保留原始 epicure 名', ing?.epicure === 'yu_choy', ing?.epicure || '未解析');
check('同时给出中文显示名', ing?.cn === '油菜', ing?.cn || '无');

console.log('\n【5】图谱邻居中文化（抽样）');
let totalNodes = 0;
let totalUntranslated = 0;
for (const seed of ['tofu', 'pork', 'yu_choy', 'chili']) {
  const net = await buildNetwork([seed], { topK: 8, depth: 2, expand: 2 });
  const bad = net.nodes.filter((n) => /_/.test(n.cn || ''));
  const untranslated = net.nodes.filter((n) => n.translated === false);
  totalNodes += net.nodes.length;
  totalUntranslated += untranslated.length;
  check(
    `${seed} 的 ${net.nodes.length} 个节点无下划线标识`,
    net.nodes.length > 0 && bad.length === 0,
    bad.map((n) => n.cn).join(',') || ''
  );
  if (untranslated.length) {
    console.log(`    未翻译（已标记，显示英文原名）：${untranslated.map((n) => n.cn).join('、')}`);
  }
}
check(
  `翻译覆盖率 ${(((totalNodes - totalUntranslated) / totalNodes) * 100).toFixed(1)}%（${totalNodes - totalUntranslated}/${totalNodes}）`,
  totalUntranslated / totalNodes < 0.15,
  `未翻译 ${totalUntranslated} 个`
);

console.log(`\n${'─'.repeat(46)}`);
console.log(`名称解析验收：${pass} 通过 / ${fail} 失败`);
if (fail) console.log('失败项：', failures.join('、'));
process.exit(fail ? 1 : 0);
