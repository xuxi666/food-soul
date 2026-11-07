/**
 * 画册外壳：封面 / 双页 / 中缝 / 书签 / 翻页纸叶 / 镜头
 * 只负责结构与动画，不关心章节内容。
 */
import { h } from '../lib/dom.js';
import { CHAPTERS } from './chapters.js';

export function createShell(root) {
  /* ---------- 封面 ---------- */
  const coverFront = h(
    'div',
    { class: 'bk-cover__front' },
    h(
      'div',
      { class: 'bk-cover__frame' },
      h('span', { class: 'bk-cover__corner bk-cover__corner--tl' }),
      h('span', { class: 'bk-cover__corner bk-cover__corner--tr' }),
      h('span', { class: 'bk-cover__corner bk-cover__corner--bl' }),
      h('span', { class: 'bk-cover__corner bk-cover__corner--br' })
    ),
    h(
      'div',
      { class: 'bk-cover__body' },
      h('p', { class: 'bk-cover__kicker', text: 'CHINESE CUISINE ATLAS' }),
      h('h1', { class: 'bk-cover__title', text: '食有灵' }),
      h('p', { class: 'bk-cover__en', text: 'FOOD SOUL' }),
      h('span', { class: 'bk-cover__rule' }),
      h('p', { class: 'bk-cover__sub', text: '一本可以翻的中国美食典藏' }),
      h('p', { class: 'bk-cover__hint', text: '轻点封面 · 翻开画册' })
    ),
    h('div', { class: 'bk-cover__mountains', 'aria-hidden': 'true' })
  );

  const coverInner = h(
    'div',
    { class: 'bk-cover__inner' },
    h(
      'div',
      { class: 'bk-cover__inner-body' },
      h('p', { class: 'bk-cover__colophon', text: '食有灵 · 中国美食典藏' }),
      h('p', { class: 'bk-cover__colophon', text: '八大菜系 · 近百道菜 · 每道一道人格' }),
      h('span', { class: 'bk-cover__rule' }),
      h('p', { class: 'bk-cover__colophon bk-cover__colophon--dim', text: '左侧书签翻章 · 页脚翻页' })
    )
  );

  const cover = h('div', { class: 'bk-cover', role: 'button', tabindex: '0', 'aria-label': '翻开画册' }, coverFront, coverInner);

  /* ---------- 书页 ---------- */
  // 页面本身只负责纸张背景与页码；内容放在跨双页的内容层里，
  // 由 CSS 分栏（column-count: 2）自然分成左右两页，中缝落在分栏间隙上。
  const pageL = h(
    'section',
    { class: 'bk-page bk-page--left', 'aria-label': '左页' },
    h('span', { class: 'bk-page__folio bk-page__folio--left' })
  );
  const pageR = h(
    'section',
    { class: 'bk-page bk-page--right', 'aria-label': '右页' },
    h('span', { class: 'bk-page__folio bk-page__folio--right' })
  );

  const content = h('div', { class: 'bk-content' });

  const gutter = h('div', { class: 'bk-gutter', 'aria-hidden': 'true' }, h('span', { class: 'bk-gutter__shade bk-gutter__shade--l' }), h('span', { class: 'bk-gutter__shade bk-gutter__shade--r' }));

  const leaf = h(
    'div',
    { class: 'bk-leaf', 'aria-hidden': 'true' },
    h('div', { class: 'bk-leaf__face bk-leaf__face--front' }),
    h('div', { class: 'bk-leaf__face bk-leaf__face--back' })
  );

  const spread = h('div', { class: 'bk-spread' }, pageL, gutter, pageR, content, leaf);

  const book = h(
    'div',
    { class: 'bk-book' },
    h('div', { class: 'bk-book__shadow', 'aria-hidden': 'true' }),
    spread,
    cover
  );

  const camera = h('div', { class: 'bk-camera' }, book);

  /* ---------- 书签 ---------- */
  const marksL = h('div', { class: 'bk-marks bk-marks--left' });
  const marksR = h('div', { class: 'bk-marks bk-marks--right' });
  const markEls = new Map();

  for (const ch of CHAPTERS) {
    const btn = h(
      'button',
      { class: `bk-mark bk-mark--${ch.side}`, type: 'button', 'data-chapter': ch.id, title: ch.label },
      h('span', { class: 'bk-mark__num', text: ch.num }),
      h('span', { class: 'bk-mark__label', text: ch.label })
    );
    markEls.set(ch.id, btn);
    (ch.side === 'left' ? marksL : marksR).append(btn);
  }

  /* ---------- 印章入口 ---------- */
  const sealPanel = h('div', { class: 'bk-seal__panel' });
  const sealBtn = h(
    'button',
    { class: 'bk-seal', type: 'button', 'aria-expanded': 'false', 'aria-label': '账号与设置' },
    h('span', { class: 'bk-seal__mark', text: '印' })
  );
  const tools = h('div', { class: 'bk-tools' }, sealBtn, sealPanel);

  /* ---------- 页脚翻页 ---------- */
  const prevBtn = h('button', { class: 'bk-turn bk-turn--prev', type: 'button', 'aria-label': '上一页' }, '‹ 上一页');
  const nextBtn = h('button', { class: 'bk-turn bk-turn--next', type: 'button', 'aria-label': '下一页' }, '下一页 ›');

  const backBtn = h(
    'button',
    { class: 'bk-back', type: 'button', 'aria-label': '合上画册' },
    h('span', { class: 'bk-back__icon', 'aria-hidden': 'true' }, '←'),
    h('span', { class: 'bk-back__label', text: '合上' })
  );

  // 书签与翻页按钮放进相机内，随书本一起位移、缩放
  camera.append(marksL, marksR, prevBtn, nextBtn);

  const stage = h(
    'div',
    { class: 'bk-stage' },
    h('div', { class: 'bk-ambient', 'aria-hidden': 'true' }),
    h('div', { class: 'bk-mountains', 'aria-hidden': 'true' }),
    camera,
    tools,
    backBtn
  );

  root.append(stage);

  return {
    el: stage,
    book,
    camera,
    spread,
    pageL,
    pageR,
    content,
    cover,
    leaf,
    marks: markEls,
    sealBtn,
    sealPanel,
    prevBtn,
    nextBtn,
    backBtn,
    setActive(id) {
      for (const [key, el] of markEls) el.classList.toggle('is-on', key === id);
    },
    setFolio(left, right) {
      pageL.querySelector('.bk-page__folio').textContent = left || '';
      pageR.querySelector('.bk-page__folio').textContent = right || '';
    },
  };
}
