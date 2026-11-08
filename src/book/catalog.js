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

/** 左页主视觉：项目里真实存在的一张菜品摄影（水煮鱼，川菜） */
const HERO = {
  src: '/dishes/shui-zhu-yu.jpg',
  alt: '一大盆水煮鱼，红油汤面上浮着干辣椒与花椒',
  note: '水煮鱼',
  meta: '川菜 · 麻辣鲜香',
  theme: '一席之间，见山河与烟火',
};

/** 品牌介绍（与画册真实功能一一对应） */
const INTRO =
  '食有灵是一座融合中华美食文化与人工智能的数字美食画册。在这里，你可以探索八大菜系、发现不同风味、认识食材之间的关系，也可以与AI交流美食和烹饪。';

/** 五项核心特色 */
const FEATURES = [
  { name: '中华美食', desc: '探索经典菜肴与地域文化。' },
  { name: '风味探索', desc: '从味觉特征发现更多美食。' },
  { name: 'AI 对话', desc: '与不同美食角色进行交流。' },
  { name: '食材探索', desc: '发现食材之间的风味联系。' },
  { name: '智能烹饪', desc: '获取菜谱与烹饪建议。' },
];

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
      /* 品牌题头 */
      h(
        'header',
        { class: 'catalog__masthead' },
        h('p', { class: 'catalog__kicker', text: 'PREFACE · 序' }),
        h(
          'h1',
          { class: 'catalog__brand' },
          h('span', { class: 'catalog__brand-cn', text: '食有灵' }),
          h('span', { class: 'catalog__brand-en', text: 'FOOD SOUL' })
        ),
        h('p', { class: 'catalog__slogan', text: '「以食为媒，探索中华风味的灵魂。」' })
      ),

      /* 主视觉：一张真实的菜品摄影，细边框，下方图注 */
      h(
        'figure',
        { class: 'catalog__hero' },
        h('span', { class: 'catalog__hero-frame', 'aria-hidden': 'true' }),
        hero,
        h(
          'figcaption',
          { class: 'catalog__hero-note' },
          h(
            'span',
            { class: 'catalog__hero-title' },
            h('span', { class: 'catalog__hero-mark', text: '图注' }),
            h('span', { class: 'catalog__hero-name', text: HERO.note }),
            h('span', { class: 'catalog__hero-meta', text: HERO.meta })
          ),
          h('span', { class: 'catalog__hero-theme', text: HERO.theme })
        )
      ),

      /* 品牌介绍 */
      h('p', { class: 'catalog__intro', text: INTRO }),

      /* 五项特色：横向一排，小编号 + 名称 + 一句说明 */
      h(
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
      ),

      /* 收尾 */
      h(
        'div',
        { class: 'catalog__welcome' },
        h('p', { class: 'catalog__welcome-text', text: '翻开这一页，开启一场关于中国美食的探索。' }),
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