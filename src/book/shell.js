/**
 * 画册外壳：封面 / 双页 / 中缝 / 书签 / 翻页纸叶 / 镜头
 * 只负责结构与动画，不关心章节内容。
 */
import { h } from '../lib/dom.js';
import { createFoodWall } from './foodwall.js';

export function createShell(root) {
  /* 书签接口由 index.js 挂载（书签需要知道章节对应第几页，那时才有页面库） */
  let markApi = null;
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
  // 纸面（.bk-page）只给「合上的书」和开书过程当底纸；
  // 进入阅读态之后，看到的内容都来自盖在上面的纸张正反面。
  const pageL = h('section', { class: 'bk-page bk-page--left', 'aria-label': '左页' });
  const pageR = h('section', { class: 'bk-page bk-page--right', 'aria-label': '右页' });

  // 纸张栈的宿主：透视挂在这里，四张纸都在里面绕书脊转
  // 页码不再显示给用户（内部页码仍由 pages.js 维护，供书签定位与翻页使用）
  const content = h('div', { class: 'bk-content' });

  // 暂存区：整章模块先在这里按「一页纸」的尺寸排版，再切成左右两页
  const staging = h('div', { class: 'bk-staging', 'aria-hidden': 'true' });

  const gutter = h('div', { class: 'bk-gutter', 'aria-hidden': 'true' }, h('span', { class: 'bk-gutter__shade bk-gutter__shade--l' }), h('span', { class: 'bk-gutter__shade bk-gutter__shade--r' }));

  const spread = h('div', { class: 'bk-spread' }, pageL, gutter, pageR, staging, content);

  /*
   * 环境阴影（独立层）：不放进 .bk-book，避免继承 15° 旋转。
   * 只跟随书本的位置与缩放，方向始终固定在背景坐标系里。
   */
  const shadow = h(
    'div',
    { class: 'bk-shadow', 'aria-hidden': 'true' },
    h('span', { class: 'bk-shadow__ambient' }),
    h('span', { class: 'bk-shadow__contact' })
  );

  const book = h('div', { class: 'bk-book' }, spread, cover);

  const camera = h('div', { class: 'bk-camera' }, shadow, book);

  /* ---------- 书签：挂在书里，跟着书缩放 / 倾斜 / 开合 ---------- */
  function attachMarks(api) {
    markApi = api;
    book.append(api.layer);
  }

  /* ---------- 印章入口 ---------- */
  const sealPanel = h('div', { class: 'bk-seal__panel' });
  const sealBtn = h(
    'button',
    { class: 'bk-seal', type: 'button', 'aria-expanded': 'false', 'aria-label': '账号与设置' },
    h('span', { class: 'bk-seal__mark', text: '印' })
  );
  const tools = h('div', { class: 'bk-tools' }, sealBtn, sealPanel);

  /* ---------- 返回目录 ---------- */
  // 目录是画册的第一跨页：回到目录 = 往回翻若干页（走和书签同一条 openChapter）
  const catalogBtn = h(
    'button',
    { class: 'bk-catalog-btn', type: 'button', 'aria-label': '回到目录' },
    h('span', { class: 'bk-catalog-btn__icon', 'aria-hidden': 'true' }, '☰'),
    h('span', { class: 'bk-catalog-btn__label', text: '目录' })
  );

  /* ---------- 合上画册 ---------- */
  const backBtn = h(
    'button',
    { class: 'bk-back', type: 'button', 'aria-label': '合上画册' },
    h('span', { class: 'bk-back__icon', 'aria-hidden': 'true' }, '←'),
    h('span', { class: 'bk-back__label', text: '合上' })
  );

  /*
   * 背景三层：美食图片墙 → 模糊 / 暖白遮罩 → 环境光。
   * 三层都 pointer-events:none，且排在 camera 之前，所以永远在画册下面。
   */
  const wall = createFoodWall();
  const veil = h(
    'div',
    { class: 'bk-wall__veil', 'aria-hidden': 'true' },
    h('span', { class: 'bk-wall__blur' }),
    h('span', { class: 'bk-wall__glow' })
  );

  const stage = h(
    'div',
    { class: 'bk-stage', 'data-book-build': 'sheet-2.2' },
    wall.el,
    veil,
    h('div', { class: 'bk-ambient', 'aria-hidden': 'true' }),
    h('div', { class: 'bk-mountains', 'aria-hidden': 'true' }),
    camera,
    tools,
    catalogBtn,
    backBtn
  );

  root.append(stage);

  return {
    el: stage,
    wall,
    book,
    shadow,
    camera,
    spread,
    pageL,
    pageR,
    content,
    cover,
    staging,
    attachMarks,
    get marks() {
      return markApi;
    },
    sealBtn,
    sealPanel,
    catalogBtn,
    backBtn,
    setActive(id) {
      markApi?.setActive(id);
    },
    /* 页码已不显示：保留空实现，免得旧调用点报错（内部索引在 pages.js） */
    setFolio() {},
  };
}
