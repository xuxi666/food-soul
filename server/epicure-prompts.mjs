/**
 * Epicure 厨房的提示词。
 * 关键点：把 Epicure 的真实计算结果（搭配分、近邻、风味关联、文化画像）
 * 作为「事实层」注入，并明确禁止编造数据；没有结果时如实说明。
 */

const STYLE_HINT = {
  home: '家常菜：步骤少、火候宽容、食材易得，适合工作日晚餐',
  refined: '精致料理：讲究刀工、层次与摆盘，但必须能用家庭灶具完成',
  fusion: '创意融合：以中国烹饪为底，做跨风味的组合，不能变成西餐',
  regional: '地方风味：贴近某一地区的家常做法与调味习惯',
  snack: '休闲小食：小吃、点心、下酒菜，分量小、风味集中',
  healthy: '健康轻食：少油少盐、以蒸煮炖拌为主，但要有滋味',
  random: '随机创作：在满足食材与约束的前提下自由发挥',
};

const DIFF = { easy: '简单', medium: '中等', hard: '复杂' };
const INNOV = { low: '传统改良：以经典做法为骨架，只做小幅调整', mid: '适度创新：换一两种食材或调味，保留熟悉的吃法', high: '大胆创新：允许全新搭配与做法，但必须符合中国菜的烹饪逻辑' };

export function buildCreativePrompt(input, analysis) {
  const lines = [];

  lines.push('你是一位熟悉中国八大菜系与民间做法的中餐研发厨师。请根据给定食材与要求，设计一道中国菜。');
  lines.push('');
  lines.push('## 硬性要求');
  lines.push('1. 成品必须是中国菜：可用八大菜系技法、地方做法或中式创新，禁止输出西餐、日料、东南亚菜等外国菜谱。');
  lines.push('2. 若用户提到外国菜名，只能作为风味灵感，最终仍要落回中国烹饪逻辑（炒/爆/烧/炖/蒸/焖/煨/拌/卤/烤等）。');
  lines.push('3. 只输出一个 JSON 对象，不要 Markdown 代码块，不要解释文字。');
  lines.push('4. 食材用量用数字 + 单位（g / ml / 个 / 勺），步骤要写清火候与时间。');
  lines.push('5. 不得编造 Epicure 数据；下方「风味分析」里没有的分数、百分位、相似度，一律不要写进 JSON。');
  lines.push('');

  lines.push('## 用户食材');
  for (const it of input.ingredients) {
    lines.push(`- ${it.cn}${it.amount ? `（${it.amount}${it.unit || 'g'}）` : ''}${it.role === 'aux' ? ' · 辅助' : ' · 主要'}${it.required ? ' · 必须使用' : ''}`);
  }
  if (!input.ingredients.length) lines.push('- （未指定，可自行搭配常见中式食材）');
  lines.push(`- 允许自行补充其他食材：${input.allowAdd ? '是' : '否'}`);
  lines.push('');

  lines.push('## 创作方向');
  lines.push(`- 风格：${STYLE_HINT[input.style] || STYLE_HINT.home}`);
  if (input.cuisine) lines.push(`- 菜系方向：${input.cuisine}`);
  if (input.taste) lines.push(`- 口味倾向：${input.taste}`);
  if (input.technique) lines.push(`- 烹饪方式：${input.technique}`);
  if (input.scene) lines.push(`- 用餐场景：${input.scene}`);
  if (input.dishType) lines.push(`- 菜式形态：${input.dishType}`);
  if (input.complexity) lines.push(`- 出品定位：${input.complexity}`);
  if (input.flavorProfile) lines.push(`- 风味取向：${input.flavorProfile}`);
  if (input.specialRequests) lines.push(`- 特别要求：${input.specialRequests}`);
  lines.push(`- 难度：${DIFF[input.difficulty] || '中等'}`);
  lines.push(`- 创新程度：${INNOV[input.innovation] || INNOV.mid}`);
  lines.push(`- 份量：${input.servings} 人`);
  if (input.dishName) lines.push(`- 用户指定菜名：${input.dishName}（若与食材明显冲突，可按食材调整，但保留其意境）`);
  if (input.extra) lines.push(`- 额外要求：${input.extra}`);
  lines.push('');

  const adv = input.advanced || {};
  const advLines = [];
  if (adv.avoidIngredients) advLines.push(`- 绝对不能用：${adv.avoidIngredients}`);
  if (adv.highlightFlavor) advLines.push(`- 希望突出：${adv.highlightFlavor}`);
  if (adv.avoidFlavor) advLines.push(`- 希望避免：${adv.avoidFlavor}`);
  if (adv.maxMinutes) advLines.push(`- 总时长不超过 ${adv.maxMinutes} 分钟`);
  if (adv.maxIngredients) advLines.push(`- 食材种类不超过 ${adv.maxIngredients} 种`);
  if (adv.budget) advLines.push(`- 预算档位：${adv.budget}`);
  advLines.push(`- 允许替代食材：${adv.allowSubstitute ? '是' : '否'}`);
  advLines.push(`- 允许添加辅助食材：${adv.allowAux ? '是' : '否'}`);
  if (advLines.length) {
    lines.push('## 高级约束');
    lines.push(...advLines);
    lines.push('');
  }

  if (analysis?.used) {
    lines.push('## Epicure 风味分析（真实计算结果，可直接引用，但不得改写数值）');
    if (analysis.pairs?.length) {
      lines.push('食材两两搭配（余弦相似度，0–1，越高越协调）：');
      for (const p of analysis.pairs) {
        lines.push(`- ${p.a} × ${p.b}：${p.score.toFixed(3)}${p.label ? `（${p.label}）` : ''}`);
      }
    }
    if (analysis.pairingText) {
      lines.push('整体搭配图谱：');
      lines.push(analysis.pairingText.slice(0, 900));
    }
    if (analysis.cultural) {
      lines.push('文化画像（Epicure 给出的是区域倾向，仅作参考，不改变「必须是中国菜」的要求）：');
      lines.push(analysis.cultural.slice(0, 400));
    }
    lines.push('');
    lines.push('请在 flavor_design.pairing_notes 里用一两句话概括这些真实结果如何影响了你的搭配，不要罗列数字。');
  } else {
    lines.push('## 风味分析');
    lines.push('本次未取得 Epicure 的计算结果，请不要声称做过风味计算，也不要编造搭配分数；按你对中国菜的理解设计即可。');
  }
  lines.push('');

  lines.push('## 输出 JSON 结构（严格遵守字段名）');
  lines.push(`{
  "dish_name": "菜名，不超过 12 字，要有中国菜的语感",
  "dish_type": "traditional 或 original（现实中已有的经典菜用 traditional，你新创的用 original）",
  "cuisine_style": "川菜 / 粤菜 / 鲁菜 / 苏菜 / 闽菜 / 浙菜 / 湘菜 / 徽菜 / 地方风味 / 创新融合 之一",
  "intro": "一句话介绍，40 字内",
  "flavor_profile": ["咸鲜", "微辣"],
  "difficulty": "easy / medium / hard",
  "servings": ${input.servings},
  "prep_minutes": 15,
  "cook_minutes": 20,
  "ingredients": [{"name":"香菇","amount":150,"unit":"g","role":"main 或 aux","substitutable":true}],
  "steps": [{"step":1,"action":"具体操作","heat":"中火","minutes":3,"note":"注意事项，可为空"}],
  "flavor_design": {"pairing_notes":"为什么这样搭配（结合上面的真实分析）","key_flavors":["菌香","椒麻"],"risk":"可能的失败点与补救"},
  "creation_notes": "创作说明：灵感来源、风味设计思路、与用户要求的对应关系"
}`);
  lines.push('');
  lines.push('原创菜（dish_type=original）不要编造历史典故或名人传说；传统菜才可以引用公认来历。');

  return lines.join('\n');
}

/* ============================================================
 * 聊天里的风味上下文
 * 只在用户明确问「搭配 / 相似 / 菜系 / 差异 / 创新」时才查 Epicure，
 * 且最多两次调用，失败静默跳过，绝不影响 SSE。
 * ============================================================ */

const INTENTS = [
  { id: 'pair', re: /搭配|相配|搭不搭|配不配|能不能一起|合不合|配在一起/ },
  { id: 'suggest', re: /适合.{0,6}(搭|配)|配什么|还能.{0,4}(配|搭)|和什么.{0,4}(搭|配)/ },
  { id: 'similar', re: /相似|接近|类似.{0,6}(食材|味道|风味)|差不多|相近/ },
  { id: 'cuisine', re: /菜系|哪个地方|哪一系|属于哪|地域/ },
  { id: 'difference', re: /区别|差异|不同|差别|哪个更/ },
  { id: 'innovate', re: /创新|改造|换.{0,2}方向|做出新|变个做法/ },
];

export function detectFlavorIntent(text) {
  const t = String(text || '');
  for (const it of INTENTS) if (it.re.test(t)) return it.id;
  return '';
}

/** 从中文句子里找出词表里的食材（长名优先，最多 3 个） */
export function extractIngredients(text, lexiconItems) {
  const t = String(text || '');
  const hits = [];
  const sorted = [...lexiconItems].sort((a, b) => b.cn.length - a.cn.length);
  for (const item of sorted) {
    if (item.cn.length < 2) continue;
    if (t.includes(item.cn) && !hits.some((h) => h.cn === item.cn || h.cn.includes(item.cn) || item.cn.includes(h.cn))) {
      hits.push(item);
    }
    if (hits.length >= 3) break;
  }
  return hits;
}

/**
 * 生成聊天用的 Epicure 数据块。
 * @returns {Promise<{used:boolean, block:string, tools:string[]}>}
 */
export async function buildChatFlavorContext({ text, lexiconItems, runTool }) {
  const intent = detectFlavorIntent(text);
  if (!intent) return { used: false, block: '', tools: [] };

  const ings = extractIngredients(text, lexiconItems);
  if (!ings.length) return { used: false, block: '', tools: [] };

  const lines = [];
  const tools = [];
  const push = (s) => lines.push(s);

  try {
    if (intent === 'pair' && ings.length >= 2) {
      const r = await runTool('pairing_score', { ingredient_a: ings[0].cn, ingredient_b: ings[1].cn });
      tools.push('pairing_score');
      if (r.ok) {
        const s = Number(r.data?.pairing_score);
        push(`- ${ings[0].cn} × ${ings[1].cn}：搭配分 ${Number.isFinite(s) ? s.toFixed(3) : '（无）'}${r.data?.percentile_label ? `（${r.data.percentile_label}）` : ''}`);
      }
    } else if (intent === 'suggest' || intent === 'innovate') {
      const r = await runTool('find_pairings', { ingredients: ings.map((i) => i.cn) });
      tools.push('find_pairings');
      if (r.ok && r.text) push(`- ${ings[0].cn} 的搭配图谱：${r.text.replace(/\s+/g, ' ').slice(0, 420)}`);
    } else if (intent === 'similar') {
      const r = await runTool('neighbors', { ingredient: ings[0].cn, top_k: 6 });
      tools.push('neighbors');
      if (r.ok) {
        const list = (r.data?.neighbors || []).slice(0, 6).map((n) => `${n.name} ${Number(n.sim).toFixed(3)}`);
        if (list.length) push(`- 与 ${ings[0].cn} 最接近的食材：${list.join('、')}`);
      }
    } else if (intent === 'cuisine') {
      const r = await runTool('cultural_profile', { ingredient: ings[0].cn });
      tools.push('cultural_profile');
      if (r.ok && r.text) push(`- ${ings[0].cn} 的菜系关联：${r.text.replace(/\s+/g, ' ').slice(0, 360)}`);
    } else if (intent === 'difference' && ings.length >= 2) {
      const r = await runTool('pairing_score', { ingredient_a: ings[0].cn, ingredient_b: ings[1].cn });
      tools.push('pairing_score');
      if (r.ok) {
        const s = Number(r.data?.pairing_score);
        push(`- ${ings[0].cn} 与 ${ings[1].cn} 的余弦相似度 ${Number.isFinite(s) ? s.toFixed(3) : '（无）'}（越高说明风味越接近）`);
      }
    }
  } catch {
    return { used: false, block: '', tools: [] };
  }

  if (!lines.length) return { used: false, block: '', tools };

  const block = [
    '',
    '## Epicure 实测数据（真实计算结果）',
    ...lines,
    '使用规则：',
    '1. 只能引用上面出现的数值，不要编造其它分数、排名或百分位；',
    '2. 这些是统计意义上的风味关联，不是营养、健康或过敏结论，不能这样解释；',
    '3. 回答要自然融入，不要把这段数据原样念出来。',
  ].join('\n');

  return { used: true, block, tools };
}
