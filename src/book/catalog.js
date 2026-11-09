/**
 * 画册目录页 —— 开书之后的第一跨页
 * ------------------------------------------------------------
 * 左页：品牌序章（标题 / 主视觉 / 品牌介绍 / 五项特色 / 收尾序言）
 * 右页：全书目录（分组 + 编号 + 名称 + 一句介绍 + 书签小标 + 翻页提示）
 *
 * 这一页不维护任何「模块 → 地址」的表：
 *   · 条目来自 chapters.js 的 CHAPTERS（id / label / title / desc / group / num / tint / href）
 *   · 翻页索引 / 页码来自同一份表的 chapterSpread() / chapterPages()
 *   · 点击只把章节 id 交给外面的 onPick → 书册 openChapter（侧边书签用的是同一个函数）
 * 所以目录条目和实体书签不可能对不上：它们是同一份数据的两处视图。
 */
import { h } from '../lib/dom.js';
import { CATALOG_GROUPS, CHAPTERS, catalogEntries, chapterSpread, chapterPages } from './chapters.js';

const CN_NO = ['一', '二', '三', '四', '五', '六', '七', '八'];
const CN_NUM = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 两位页码：4 → 04 */
const pageLabel = (n) => String(n).padStart(2, '0');

/** #b5452f + 0.55 → rgba(181,69,47,.55) */
function rgba(hex, a) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(hex).trim());
  if (!m) return `rgba(181, 69, 47, ${a})`;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})`;
}

/** 左页主视觉：一席中华美食全景（淡墨山水 + 多道菜品同框） */
const HERO = {
  src: '/bg/panorama.jpg',
  alt: '山水长卷前的一席中华美食：炒菜、汤面、蒸鱼、小笼包与炖汤',
};

/** 品牌介绍：按参考图断成五行 */
const INTRO_LINES = [
  '食有灵是一座融合中华美食文化',
  '与人工智能的数字美食画册。',
  '在这里，你可以探索八大菜系、',
  '发现不同风味、认识食材之间的关系，',
  '也可以与AI交流美食与烹饪。',
];

/** 五项核心特色：图标 + 名称 + 两行说明 */
const FEATURES = [
  { icon: 'bowl', name: '中华美食', desc: ['探索经典菜肴', '与地域文化'] },
  { icon: 'flame', name: '风味探索', desc: ['从不同味觉特征', '发现美食'] },
  { icon: 'bot', name: 'AI对话', desc: ['与不同美食角色', '趣味交流'] },
  { icon: 'leaf', name: '食材探索', desc: ['了解食材搭配', '与风味奥秘'] },
  { icon: 'chef', name: '智能烹饪', desc: ['获取菜谱与', '烹饪建议'] },
];

/** 五栏线描图标：统一 32 视图、1.3 描边，颜色跟随 currentColor */
const FEATURE_ICONS = {
  bowl: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15h24c0 6.2-5.4 11-12 11S4 21.2 4 15z"/><path d="M3 15h26"/><path d="M13 26h6"/><path d="M12 29h8"/><path d="M11 10c0-1.6 1.2-2 1.2-3.4M16 9.4c0-1.6 1.2-2 1.2-3.4M21 10c0-1.6 1.2-2 1.2-3.4"/></svg>',
  flame: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3c1.4 4.6 6.2 6.4 6.2 12.2 0 5-3.1 8.8-7.6 8.8-3.7 0-6.4-2.5-6.4-6.1 0-3.4 2.3-5.6 3.9-7.6.3 1.9 1 3.2 2.2 4.1C14.9 10.4 15.4 6.6 16 3z"/><path d="M16 27.6c1.8 0 3-1.3 3-3.1 0-1.9-1.4-3.1-3-4.6-1.6 1.5-3 2.7-3 4.6 0 1.8 1.2 3.1 3 3.1z"/></svg>',
  bot: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="10" width="18" height="14" rx="4"/><path d="M16 10V6.4"/><circle cx="16" cy="5" r="1.4"/><circle cx="12.4" cy="16" r="1.5"/><circle cx="19.6" cy="16" r="1.5"/><path d="M13 20.4h6"/><path d="M7 16H4.4M25 16h2.6"/></svg>',
  leaf: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M26.5 6.5c0 11.6-6.8 19-17 19-.9 0-1.9-.1-2.7-.3 1.5-8.6 8.3-15.4 19.7-18.7z"/><path d="M9 23.6c3-6.4 7.2-10.6 13.2-13.6"/></svg>',
  chef: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14.6c-2.6 0-4.6-2-4.6-4.5S7.4 5.6 10 5.6c.7 0 1.4.2 2 .5C13 4.6 14.4 4 16 4s3 .6 4 2.1c.6-.3 1.3-.5 2-.5 2.6 0 4.6 2 4.6 4.5s-2 4.5-4.6 4.5H10z"/><path d="M10 14.6h12v9.8c0 1.9-1.5 3.4-3.4 3.4h-5.2c-1.9 0-3.4-1.5-3.4-3.4v-9.8z"/><path d="M10 18.4h12" stroke-opacity=".7"/></svg>',
};

/** 右上淡金祥云 */
const CLOUD_SVG =
  '<svg viewBox="0 0 330 150" fill="none" stroke="currentColor" stroke-width="1.1"><path d="M40 96c-14 0-24-9-24-20s10-20 23-20c2-14 14-24 29-24 13 0 24 8 28 19 4-2 9-3 14-3 15 0 27 11 27 24 0 14-12 24-27 24H40z"/><path d="M104 96c2 10 11 17 22 17 9 0 17-5 21-13 3 1 6 2 9 2 12 0 22-8 22-19 0-10-9-18-21-18-2-9-11-16-21-16-11 0-20 8-21 18-7 2-12 8-12 15 0 5 2 10 6 14"/><path d="M206 78c-10 0-18-7-18-16 0-8 7-15 16-15 2-10 11-17 21-17 9 0 17 5 20 13 3-1 6-2 9-2 11 0 20 8 20 18 0 11-9 19-20 19h-48z"/><path d="M250 112c0 8 7 14 15 14 6 0 11-3 14-8 2 1 4 1 6 1 8 0 15-6 15-13s-7-13-15-13c-2-6-8-10-14-10-8 0-14 5-15 13-4 2-6 5-6 9 0 3 1 5 3 7"/><path d="M18 118c22 6 46 8 70 5M132 124c26 5 54 5 80-1M236 132c24 4 48 2 70-5" stroke-opacity=".55"/></svg>';

/** 底部淡金山峦：三层曲线 + 雾带 */
const RIDGE_SVG =
  '<svg viewBox="0 0 643 120" preserveAspectRatio="none" fill="none"><defs><linearGradient id="ct-ridge-1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9a877" stop-opacity="0"/><stop offset=".45" stop-color="#c9a877" stop-opacity=".52"/><stop offset="1" stop-color="#c9a877" stop-opacity=".04"/></linearGradient><linearGradient id="ct-ridge-2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8925c" stop-opacity="0"/><stop offset=".5" stop-color="#b8925c" stop-opacity=".60"/><stop offset="1" stop-color="#b8925c" stop-opacity=".05"/></linearGradient></defs><path d="M0 82 C26 78 36 50 72 48 C108 46 120 72 154 70 C188 68 198 40 234 38 C270 36 282 70 316 72 C350 74 360 46 396 44 C432 42 444 72 478 74 C512 76 522 50 558 48 C590 46 616 76 643 80 L643 120 L0 120 Z" fill="url(#ct-ridge-1)"/><path d="M0 98 C32 96 46 70 82 68 C118 66 132 92 166 94 C200 96 212 70 246 68 C280 66 294 94 328 96 C362 98 374 74 408 72 C442 70 456 96 490 98 C524 100 536 78 570 76 C602 74 622 98 643 100 L643 120 L0 120 Z" fill="url(#ct-ridge-2)"/></svg>';

/** 图标元素 */
function iconEl(key) {
  return h('span', { class: 'catalog__feat-icon', 'aria-hidden': 'true', html: FEATURE_ICONS[key] || '' });
}

/**
 * @param {HTMLElement} host 暂存区（测量用）
 * @param {{ onPick?: (id: string) => void }} [opts]
 */
export function mountCatalog(host, opts = {}) {
  const onPick = opts.onPick || (() => {});
  const items = [];
  const cleanups = [];

  /* ---------------- 左页 ---------------- */
  const hero = h('img', {
    class: 'catalog__hero-img',
    src: HERO.src,
    alt: HERO.alt,
    decoding: 'async',
    loading: 'eager',
  });

  const left = h(
    'div',
    { class: 'catalog__page catalog__page--left' },
    h(
      'div',
      { class: 'catalog__preface' },

      /* 主视觉：铺满纸面上半部，四边融进纸色 */
      h('figure', { class: 'catalog__hero' }, hero),

      /* 右上祥云 + 底部山峦 */
      h('span', { class: 'catalog__cloud', 'aria-hidden': 'true', html: CLOUD_SVG }),
      h('span', { class: 'catalog__ridge', 'aria-hidden': 'true', html: RIDGE_SVG }),

      /* 品牌题头 */
      h(
        'header',
        { class: 'catalog__masthead' },
        h('p', { class: 'catalog__kicker', text: 'PREFACE · 序' }),
        h(
          'h1',
          { class: 'catalog__brand' },
          h('span', { class: 'catalog__brand-cn', text: '食有灵' }),
          h(
            'span',
            { class: 'catalog__brand-seal', 'aria-hidden': 'true' },
            h('span', { text: '食' }),
            h('span', { text: '灵' })
          )
        ),
        h('p', { class: 'catalog__brand-en', text: 'FOOD SOUL' }),
        h('p', { class: 'catalog__slogan', text: '「以食为媒，探索中华风味的灵魂。」' }),
        h('span', { class: 'catalog__rule', 'aria-hidden': 'true' })
      ),

      /* 竖排主题 + 小印 */
      h(
        'div',
        { class: 'catalog__verse' },
        h('p', { class: 'catalog__verse-text', text: '不止于味，\n更在于灵。' }),
        h('span', { class: 'catalog__verse-seal', 'aria-hidden': 'true', text: '灵' })
      ),

      /* 品牌介绍：五行，逐行成行 */
      h(
        'p',
        { class: 'catalog__intro' },
        ...INTRO_LINES.map((line) => h('span', { class: 'catalog__intro-line', text: line }))
      ),

      /* 五项特色：圆形线描图标 + 名称 + 两行说明 */
      h(
        'section',
        { class: 'catalog__explore' },
        h('h2', { class: 'catalog__explore-title', text: '在这里，你可以探索' }),
        h(
          'ul',
          { class: 'catalog__feats' },
          ...FEATURES.map((f) =>
            h(
              'li',
              { class: 'catalog__feat' },
              iconEl(f.icon),
              h('span', { class: 'catalog__feat-name', text: f.name }),
              h(
                'span',
                { class: 'catalog__feat-desc' },
                ...f.desc.map((d) => h('span', { class: 'catalog__feat-line', text: d }))
              )
            )
          )
        )
      ),

      /* 收尾 */
      h(
        'div',
        { class: 'catalog__welcome' },
        h('p', { class: 'catalog__welcome-text', text: '翻开这一页，开启一场关于中华美食的探索。' }),
        h(
          'span',
          { class: 'catalog__seal', 'aria-hidden': 'true' },
          h('span', { class: 'catalog__seal-char', text: '食' }),
          h('span', { class: 'catalog__seal-char', text: '有' }),
          h('span', { class: 'catalog__seal-char', text: '灵' })
        )
      )
    )
  );

  /* ---------------- 右页 ---------------- */
  const entries = catalogEntries();

  /** 枚与实体书签同色同名的「书签小标」 */
  function bookmarkChip(ch) {
    const tint = ch.tint || '#b5452f';
    const chip = h(
      'span',
      { class: 'catalog__chip', 'aria-hidden': 'true' },
      h('span', { class: 'catalog__chip-label', text: ch.label })
    );
    chip.style.setProperty('--chip-tint', tint);
    chip.style.borderColor = rgba(tint, 0.55);
    chip.style.background = rgba(tint, 0.08);
    chip.title = `对应书口「${ch.label}」书签`;
    return chip;
  }

  function entryRow(ch) {
    const [from, to] = chapterPages(ch.id);
    const tint = ch.tint || '#b5452f';
    const row = h(
      'button',
      {
        class: 'catalog__item',
        type: 'button',
        'data-chapter': ch.id,
        'data-spread': String(chapterSpread(ch.id)),
        'data-page-from': String(from),
        'data-page-to': String(to),
        'data-href': ch.href,
        'aria-label': `${ch.num} ${ch.title}：${ch.desc}（对应「${ch.label}」书签）`,
      },
      h('span', { class: 'catalog__no', text: ch.num }),
      h(
        'span',
        { class: 'catalog__entry' },
        h(
          'span',
          { class: 'catalog__entry-head' },
          h('span', { class: 'catalog__name', text: ch.title }),
          bookmarkChip(ch)
        ),
        h('span', { class: 'catalog__desc', text: ch.desc })
      ),
      h(
        'span',
        { class: 'catalog__tail', 'aria-hidden': 'true' },
        h('span', { class: 'catalog__pages', text: `${pageLabel(from)}–${pageLabel(to)}` }),
        h('span', { class: 'catalog__turn', text: '›' })
      )
    );
    row.style.setProperty('--entry-tint', tint);
    row.addEventListener('click', () => onPick(ch.id));
    row.addEventListener('click', () => {
      row.classList.add('is-pressed');
      setTimeout(() => row.classList.remove('is-pressed'), 420);
    });
    items.push({ id: ch.id, el: row, chip: row.querySelector('.catalog__chip') });
    return row;
  }

  const groups = h(
    'div',
    { class: 'catalog__groups' },
    ...CATALOG_GROUPS.map((g) => {
      const list = entries.filter((ch) => ch.group === g.id);
      if (!list.length) return null;
      return h(
        'section',
        { class: 'catalog__group', 'data-group': g.id },
        h(
          'h3',
          { class: 'catalog__group-head' },
          h('span', { class: 'catalog__group-cn', text: g.title }),
          h('span', { class: 'catalog__group-rule', 'aria-hidden': 'true' }),
          h('span', { class: 'catalog__group-en', text: g.en })
        ),
        h('div', { class: 'catalog__list' }, ...list.map(entryRow))
      );
    }).filter(Boolean)
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
          h('span', { class: 'catalog__idx-meta', text: `共 ${entries.length} 章` })
        ),
        h('p', { class: 'catalog__idx-hint', text: '选择一处书签，翻阅你感兴趣的美食篇章。' })
      ),
      groups,
      h(
        'p',
        { class: 'catalog__note' },
        h('span', { class: 'catalog__note-mark', text: '※' }),
        h(
          'span',
          { class: 'catalog__note-text' },
          '每条目录对应书口上一枚同色书签；「目录」书签随时可以翻回这一页。AI 美食对话不单独成章，在任意菜品、菜系或口味页都能进入。'
        )
      ),
      h(
        'div',
        { class: 'catalog__colophon' },
        h('span', { class: 'catalog__colophon-left', text: '食有灵 · FOOD SOUL' }),
        h('span', { class: 'catalog__colophon-rule', 'aria-hidden': 'true' }),
        h('span', { class: 'catalog__colophon-right', text: `全书${CN_NUM[entries.length] || entries.length}章 · ${CN_NUM[CHAPTERS.length] || CHAPTERS.length}枚书签` })
      )
    )
  );

  const el = h('div', { class: 'catalog', 'data-kind': 'catalog' }, left, right);
  host?.append(el);

  /* ---------------- 目录 ↔ 实体书签：互相指出对方 ---------------- */

  /** 实体书签所在元素（书签层在书册里，不在目录页内） */
  const markOf = (id) => document.querySelector(`.bk-mark[data-chapter="${id}"]`);

  for (const item of items) {
    const on = () => {
      item.el.classList.add('is-link');
      markOf(item.id)?.classList.add('is-link');
    };
    const off = () => {
      item.el.classList.remove('is-link');
      markOf(item.id)?.classList.remove('is-link');
    };
    item.el.addEventListener('mouseenter', on);
    item.el.addEventListener('mouseleave', off);
    item.el.addEventListener('focus', on);
    item.el.addEventListener('blur', off);
    cleanups.push(() => {
      item.el.removeEventListener('mouseenter', on);
      item.el.removeEventListener('mouseleave', off);
      item.el.removeEventListener('focus', on);
      item.el.removeEventListener('blur', off);
    });
  }

  // 反向：鼠标移到实体书签上，目录里那一条也亮起来
  const reverse = [];
  for (const mark of document.querySelectorAll('.bk-mark[data-chapter]')) {
    const id = mark.dataset.chapter;
    const row = items.find((i) => i.id === id)?.el;
    if (!row) continue;
    const on = () => row.classList.add('is-link');
    const off = () => row.classList.remove('is-link');
    mark.addEventListener('mouseenter', on);
    mark.addEventListener('mouseleave', off);
    reverse.push({ mark, on, off });
  }
  cleanups.push(() => {
    for (const { mark, on, off } of reverse) {
      mark.removeEventListener('mouseenter', on);
      mark.removeEventListener('mouseleave', off);
      mark.classList.remove('is-link');
    }
  });

  /** 当前章节高亮（目录条目与书签同一份 id） */
  function setActive(chapterId) {
    for (const item of items) {
      const on = item.id === chapterId;
      item.el.classList.toggle('is-on', on);
      item.el.setAttribute('aria-current', on ? 'page' : 'false');
    }
  }

  /** 章节参数变化不影响目录（分类切换不改条目） */
  function update() {}

  return {
    el,
    left,
    right,
    setActive,
    update,
    destroy() {
      for (const fn of cleanups) fn();
      items.length = 0;
      el.remove();
    },
  };
}