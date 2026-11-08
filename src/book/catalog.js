/**
 * 画册目录页（打开的第一次翻页看到的第一跨页）
 * ------------------------------------------------------------
 * 左页：序言 —— 品牌、简介、网站特色、欢迎语
 * 右页：全站目录 —— 按分栏列条目，点条目 → onPick(chapterId)
 *
 * 重要：这一页不自己管跳转，也不自己写「模块 → 地址」的表。
 * 条目、编号、名称、介绍、分组全部来自 chapters.js；
 * 点击只把章节 id 交给外面的 openChapter（侧边书签用的是同一个函数），
 * 所以目录和书签不可能跳到两个不同的地方。
 */
import { h } from '../lib/dom.js';
import { CHAPTERS, CATALOG_GROUPS, catalogEntries } from './chapters.js';

const CN_NO = ['一', '二', '三', '四', '五', '六', '七', '八'];

/** 网站特色：每条都对应真实功能（不写没做的） */
const FEATURES = [
  { name: '中华美食', desc: '近百道中国菜的图谱，八大菜系各成一册。' },
  { name: '风味探索', desc: '麻辣、清鲜、醇厚……按八种味型横向发现美食。' },
  { name: 'AI 对话', desc: '每道菜都有自己的味型人格，可以就着菜聊。' },
  { name: '食材探索', desc: '食材库与风味图谱，看食材之间如何呼应。' },
  { name: '智能食谱', desc: '给出条件，生成结构化的菜谱与烹饪建议。' },
];

/**
 * @param {HTMLElement} host 暂存区（测量尺寸用）
 * @param {{ onPick?: (id: string) => void }} [opts]
 */
export function mountCatalog(host, opts = {}) {
  const onPick = opts.onPick || (() => {});
  const items = [];

  /* ---------------- 左页：序 ---------------- */
  const seal = h(
    'span',
    { class: 'catalog__seal', 'aria-hidden': 'true' },
    h('span', { class: 'catalog__seal-char', text: '食' }),
    h('span', { class: 'catalog__seal-char', text: '有' }),
    h('span', { class: 'catalog__seal-char', text: '灵' })
  );

  const feats = h(
    'ul',
    { class: 'catalog__feats' },
    ...FEATURES.map((f, i) =>
      h(
        'li',
        { class: 'catalog__feat' },
        h('span', { class: 'catalog__feat-no', text: CN_NO[i] || String(i + 1) }),
        h(
          'span',
          { class: 'catalog__feat-body' },
          h('span', { class: 'catalog__feat-name', text: f.name }),
          h('span', { class: 'catalog__feat-desc', text: f.desc })
        )
      )
    )
  );

  const left = h(
    'div',
    { class: 'catalog__page catalog__page--left' },
    h(
      'div',
      { class: 'catalog__preface' },
      h('p', { class: 'catalog__kicker', text: 'PREFACE · 序' }),
      h(
        'h1',
        { class: 'catalog__brand' },
        h('span', { class: 'catalog__brand-cn', text: '食有灵' }),
        h('span', { class: 'catalog__brand-en', text: 'FOOD SOUL' })
      ),
      h('p', { class: 'catalog__slogan', text: '「以食为媒，探索中华风味的灵魂。」' }),
      h('span', { class: 'catalog__rule' }),
      h(
        'p',
        { class: 'catalog__intro' },
        '食有灵是一座融合中华美食文化与人工智能的数字美食画册。这里不仅记录中国各地的经典菜肴，也探索食材之间的风味关系，让每一道美食都拥有自己的故事与表达。'
      ),
      h(
        'p',
        { class: 'catalog__sec' },
        h('span', { class: 'catalog__sec-cn', text: '网站特色' }),
        h('span', { class: 'catalog__sec-en', text: 'HIGHLIGHTS' })
      ),
      feats,
      h(
        'div',
        { class: 'catalog__welcome' },
        h('p', { class: 'catalog__welcome-text', text: '「翻开这一页，开启一场关于中国美食的探索。」' }),
        seal
      )
    )
  );

  /* ---------------- 右页：目录 ---------------- */
  const entries = catalogEntries();

  function entryRow(ch) {
    const row = h(
      'button',
      {
        class: 'catalog__item',
        type: 'button',
        'data-chapter': ch.id,
        'aria-label': `${ch.num} ${ch.title}：${ch.desc}`,
      },
      h('span', { class: 'catalog__no', text: ch.num }),
      h(
        'span',
        { class: 'catalog__entry' },
        h(
          'span',
          { class: 'catalog__entry-line' },
          h('span', { class: 'catalog__name', text: ch.title }),
          h('span', { class: 'catalog__leader', 'aria-hidden': 'true' }),
          h('span', { class: 'catalog__arrow', text: '›', 'aria-hidden': 'true' })
        ),
        h('span', { class: 'catalog__desc', text: ch.desc })
      )
    );
    row.style.setProperty('--entry-tint', ch.tint || '#b5452f');
    row.addEventListener('click', () => onPick(ch.id));
    items.push({ id: ch.id, el: row });
    return row;
  }

  const groups = h(
    'div',
    { class: 'catalog__groups' },
    ...CATALOG_GROUPS.map((g) => {
      const list = entries.filter((ch) => ch.group === g.id);
      return h(
        'section',
        { class: 'catalog__group' },
        h(
          'h3',
          { class: 'catalog__group-head' },
          h('span', { class: 'catalog__group-cn', text: g.title }),
          h('span', { class: 'catalog__group-rule', 'aria-hidden': 'true' }),
          h('span', { class: 'catalog__group-en', text: g.en })
        ),
        h('div', { class: 'catalog__list' }, ...list.map(entryRow))
      );
    })
  );

  const right = h(
    'div',
    { class: 'catalog__page catalog__page--right' },
    h(
      'div',
      { class: 'catalog__contents' },
      h(
        'header',
        { class: 'catalog__idx-head' },
        h('p', { class: 'catalog__kicker', text: 'CONTENTS · 目录' }),
        h(
          'h2',
          { class: 'catalog__idx-title' },
          h('span', { class: 'catalog__idx-cn', text: '全书目录' }),
          h('span', { class: 'catalog__idx-meta', text: `共 ${entries.length} 章 · 点击条目翻阅` })
        )
      ),
      groups,
      h(
        'p',
        { class: 'catalog__note' },
        h('span', { class: 'catalog__note-mark', text: '※' }),
        'AI 美食对话不单独成章：在任意菜品、菜系或口味页都能进入。'
      )
    )
  );

  const el = h('div', { class: 'catalog', 'data-kind': 'catalog' }, left, right);
  host?.append(el);

  /** 当前章节高亮（目录里的条目与书签同一份 id） */
  function setActive(chapterId) {
    for (const item of items) {
      const on = item.id === chapterId;
      item.el.classList.toggle('is-on', on);
      item.el.setAttribute('aria-current', on ? 'page' : 'false');
    }
  }

  /** 章节参数变了（菜系/口味换分类）：目录不需要重绘，条目与分类无关 */
  function update() {}

  return {
    el,
    setActive,
    update,
    destroy() {
      items.length = 0;
      el.remove();
    },
  };
}

/** 目录页里出现的全部章节 id（供验收脚本核对「条目 = 书签」） */
export const CATALOG_IDS = CHAPTERS.filter((c) => c.id !== 'catalog').map((c) => c.id);