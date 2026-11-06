import { h } from '../lib/dom.js';

/**
 * Epicure 风味面板（可复用）
 *
 * 两种数据来源都吃：
 * 1. /api/epicure/analyze 的返回（mode: single / pair / multi / cuisine / atlas）
 * 2. /api/recipe 里的 epicureAnalysis（只含食材 + 搭配分 + 图谱摘要）
 *
 * 约定：只显示真实返回的数值；没有数据就整块不渲染，不占位、不编造。
 */

const DIFF_LABEL = { easy: '简单', medium: '中等', hard: '复杂' };

function num(v, digits = 3) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : '';
}

function row(label, value) {
  if (!value) return null;
  return h('div', { class: 'ep-row' }, h('b', { text: label }), h('span', { text: value }));
}

/** 把 analyze 的结构化结果压成几行可读文本 */
function summarize(analysis) {
  const r = analysis?.results || {};
  const rows = [];

  if (r.pairing && typeof r.pairing === 'object') {
    const a = r.pairing.resolved_a;
    const b = r.pairing.resolved_b;
    const s = num(r.pairing.pairing_score);
    if (a && b && s) rows.push(['搭配分', `${a} × ${b} = ${s}${r.pairing.percentile_label ? `（${r.pairing.percentile_label}）` : ''}`]);
  }
  if (Array.isArray(r.pairs) && r.pairs.length) {
    rows.push([
      '组合分',
      r.pairs.map((p) => `${p.a}×${p.b} ${num(p.score)}`).join('；'),
    ]);
  }
  if (r.neighbors && Array.isArray(r.neighbors.neighbors)) {
    rows.push([
      '相似食材',
      r.neighbors.neighbors
        .slice(0, 6)
        .map((n) => `${n.name} ${num(n.sim, 3)}`)
        .join('、'),
    ]);
  }
  if (r.atlas && Array.isArray(r.atlas.atlas_xy)) {
    rows.push([
      '风味坐标',
      `(${num(r.atlas.atlas_xy[0], 2)}, ${num(r.atlas.atlas_xy[1], 2)})${r.atlas.food_group ? ` · ${r.atlas.food_group}` : ''}${
        r.atlas.cuisine_region ? ` · ${r.atlas.cuisine_region}` : ''
      }`,
    ]);
  }
  if (r.cultural) {
    const text = typeof r.cultural === 'string' ? r.cultural : JSON.stringify(r.cultural);
    rows.push(['菜系关联', text.replace(/\s+/g, ' ').slice(0, 160)]);
  }
  if (r.compare) {
    const text = typeof r.compare === 'string' ? r.compare : JSON.stringify(r.compare);
    rows.push(['轴对比', text.replace(/\s+/g, ' ').slice(0, 140)]);
  }
  return rows;
}

/**
 * @param {object} opts
 * @param {object} [opts.analysis]  /api/epicure/analyze 返回
 * @param {object} [opts.recipeAnalysis]  /api/recipe 的 epicureAnalysis
 * @param {string} [opts.title]
 * @param {boolean} [opts.loading]
 * @param {string} [opts.error]
 */
export function epicurePanel({ analysis, recipeAnalysis, title = 'Epicure 风味分析', loading = false, error = '' } = {}) {
  if (loading) {
    return h('div', { class: 'ep-panel is-loading' }, h('div', { class: 'ep-panel__head' }, h('b', { text: title })), h('p', { class: 'ep-note', text: '正在向 Epicure 请求风味数据…' }));
  }

  const rows = [];

  if (recipeAnalysis?.used) {
    if (recipeAnalysis.ingredients?.length) rows.push(['分析食材', recipeAnalysis.ingredients.join('、')]);
    if (recipeAnalysis.topPair) {
      rows.push([
        '搭配分',
        `${recipeAnalysis.topPair.a} × ${recipeAnalysis.topPair.b} = ${num(recipeAnalysis.topPair.score)}${
          recipeAnalysis.topPair.label ? `（${recipeAnalysis.topPair.label}）` : ''
        }`,
      ]);
    }
  }
  rows.push(...summarize(analysis));

  if (!rows.length) {
    if (error) return h('div', { class: 'ep-panel is-empty' }, h('p', { class: 'ep-note', text: `Epicure 暂不可用：${error}` }));
    return null;
  }

  const usedTools = (analysis?.used || []).filter((u) => u.ok).map((u) => u.tool);
  const unresolved = analysis?.unresolved || [];

  return h(
    'section',
    { class: 'ep-panel' },
    h(
      'div',
      { class: 'ep-panel__head' },
      h('b', { text: title }),
      h('span', { class: 'ep-badge', text: '真实计算' })
    ),
    h('div', { class: 'ep-rows' }, ...rows.map(([k, v]) => row(k, v))),
    unresolved.length ? h('p', { class: 'ep-note', text: `未收录的食材：${unresolved.join('、')}，这部分未参与计算。` }) : null,
    usedTools.length ? h('p', { class: 'ep-note', text: `本次调用：${usedTools.join('、')}` }) : null,
    h('p', { class: 'ep-note ep-note--dim', text: '以上为统计意义上的风味关联，不代表营养、健康或过敏结论。' })
  );
}

/** 推荐卡片上的小分数徽标 */
export function epicureChip(epicure) {
  if (!epicure || !epicure.ok) return null;
  if (epicure.basis === 'pairing' && Number.isFinite(Number(epicure.score))) {
    return h('span', { class: 'ep-chip', title: `与「${epicure.against}」的搭配分` }, `搭配 ${num(epicure.score, 2)}`);
  }
  if (epicure.basis === 'neighbors' && epicure.neighbors?.length) {
    return h('span', { class: 'ep-chip', title: `主料：${(epicure.ingredients || []).join('、')}` }, '风味近邻');
  }
  return null;
}

export default { epicurePanel, epicureChip };
