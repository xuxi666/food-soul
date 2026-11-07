/**
 * 画册编排
 * ------------------------------------------------------------
 * closed：合上的书，只见封面
 * open  ：展开的双页，每一页都是真实的一张纸面
 *
 * 翻页 = 一张有正反面的纸绕书脊转过去，不是「换一张单面纸再贴内容」：
 *   正面 = 现在右页（奇数页），背面 = 下一跨页的左页（偶数页），
 *   纸下面还压着下一张纸的右页 —— 纸一转开就露出来。
 * 正反面内容在动画开始前就贴好，动画中途只改纸张角度，不再替换内容。
 */
import { h } from '../lib/dom.js';
import { CHAPTERS, EXTRA, chapterById, chapterIndex, moduleOf, chapterOf } from './chapters.js';
import { createShell } from './shell.js';
import { createPageBook } from './pages.js';
import { createSheets } from './sheets.js';
import { createBookmarks } from './bookmarks.js';
import { computeLayout, observeLayout } from './layout.js';
import { mountAccount } from '../components/account.js';
import './book.css';
import './atlas.css';
import './category.css';
import './videos.css';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function initBook({ root }) {
  document.body.classList.add('is-book');
  const shell = createShell(root);
  let lastBox = null;

  /* ---------------- 环境阴影（独立层） ---------------- */
  // 阴影不是书本的子节点，所以不继承 15° 旋转。
  // 每帧读取「可见物体」的屏幕包围盒（合上=封面，展开=双页），
  // 把它作为阴影层的 left/top/width/height —— 只跟随位置与尺寸，方向永远水平。
  let shadowRaf = 0;
  let shadowBlend = 0;
  let blendRaf = 0;
  function blendShadowTo(to, ms = 460) {
    cancelAnimationFrame(blendRaf);
    const from = shadowBlend;
    if (Math.abs(to - from) < 0.01) {
      shadowBlend = to;
      fitShadow();
      return;
    }
    const t0 = performance.now();
    const step = () => {
      const p = Math.min(1, (performance.now() - t0) / ms);
      shadowBlend = from + (to - from) * (1 - Math.pow(1 - p, 3));
      fitShadow();
      if (p < 1) blendRaf = requestAnimationFrame(step);
    };
    step();
  }
  function fitShadow() {
    const sh = shell.shadow;
    if (!sh) return;
    const cam = shell.camera.getBoundingClientRect();
    const a = shell.cover.getBoundingClientRect();
    const b = shell.spread.getBoundingClientRect();
    if (!a.width || !b.width) return;
    const k = shadowBlend;
    const left = a.left + (b.left - a.left) * k;
    const top = a.top + (b.top - a.top) * k;
    sh.style.left = `${left - cam.left}px`;
    sh.style.top = `${top - cam.top}px`;
    sh.style.width = `${a.width + (b.width - a.width) * k}px`;
    sh.style.height = `${a.height + (b.height - a.height) * k}px`;
  }
  function followShadow(ms = 800) {
    cancelAnimationFrame(shadowRaf);
    const t0 = performance.now();
    const tick = () => {
      fitShadow();
      if (performance.now() - t0 < ms) shadowRaf = requestAnimationFrame(tick);
    };
    tick();
  }

  /* ---------------- 尺寸 ---------------- */
  function fit() {
    const box = computeLayout();
    shell.el.style.setProperty('--book-w', `${box.w}px`);
    shell.el.style.setProperty('--book-h', `${box.h}px`);
    shell.el.classList.toggle('is-single', box.mode === 'single');
    lastBox = box;
    fitShadow();
  }

  fit();
  const stopObserve = observeLayout(() => {
    const before = lastBox;
    fit();
    if (before && (before.mode !== lastBox.mode || before.w !== lastBox.w || before.h !== lastBox.h)) {
      shell.content.dataset.fitted = `${lastBox.w}x${lastBox.h}`;
      if (before.mode !== lastBox.mode) void reflow();
    }
  });

  /* ---------------- 状态机 ---------------- */
  // CLOSED_TILTED → OPENING（回正 + 掀封面，同帧启动）→ EXPANDING → READING
  const OPEN_MS = 1300;
  const CHROME_MS = 760;
  let phase = 'CLOSED_TILTED';
  function setBookState(cls) {
    shell.book.className = `bk-book ${cls}`;
    if (shell.shadow) shell.shadow.className = `bk-shadow ${cls.replace('bk-book--', 'bk-shadow--')}`;
    followShadow();
    shell.el.classList.toggle('is-reading', cls === 'bk-book--reading');
    // 合上 / 打开：书签一直留在书口，只是换一套尺寸补偿
    shell.marks?.setClosed(cls === 'bk-book--closed' || cls === 'bk-book--straight');
  }
  function setPhase(next) {
    phase = next;
  }

  /* ---------------- 页面库 + 纸页栈 ---------------- */
  let mode = 'closed';
  let busy = false;
  let currentKey = null;
  /** 当前位置：双页模式 = 第几个跨页；单页模式 = 第几页 */
  let position = { single: false, value: 0 };
  /** 内页（详情 / 后台 / 404）：单独一叠纸，不参与章节顺序 */
  let inner = null;

  const titlePage = h(
    'div',
    { class: 'bk-pageface bk-pageface--title' },
    h(
      'div',
      { class: 'bk-titlepage' },
      h('p', { class: 'bk-titlepage__kicker', text: 'CHINESE CUISINE ATLAS' }),
      h('h1', { class: 'bk-titlepage__title', text: '食有灵' }),
      h('p', { class: 'bk-titlepage__sub', text: '中国美食典藏 · 扉页' }),
      h('span', { class: 'bk-titlepage__rule' }),
      h('p', { class: 'bk-titlepage__note', text: '左页书签翻章 · 页脚翻页' })
    )
  );

  const book = createPageBook({
    staging: shell.staging,
    onAtlasChange: () => void refreshAtlas(),
  });
  const sheets = createSheets(shell.content);

  /*
   * 章节书签：一枚书签 = 一个真实章节起始页。
   * 书签上不印页码，页码只作为定位数据（targetPage / data-target-page）存在。
   * 目标页始终由页面库现算，章节内容增减 / 分页变化后自动跟着变。
   */
  const MARK_TINT = {
    dishes: '#b5452f',
    cuisines: '#9a7248',
    tastes: '#c0854a',
    recipe: '#b08e4e',
    kitchen: '#6f7f5f',
    community: '#7a5a40',
    videos: '#6e8489',
  };
  const MARK_LABEL = {
    dishes: '美食图鉴',
    cuisines: '八大菜系',
    tastes: '口味探索',
    recipe: '菜谱工作台',
    kitchen: '食材厨房',
    community: '美食社区',
    videos: '影像视频',
  };

  const marks = createBookmarks({
    list: CHAPTERS.map((ch) => ({
      id: ch.id,
      label: MARK_LABEL[ch.id] || ch.label,
      tint: MARK_TINT[ch.id] || '#b5452f',
      targetPage: book.spreadOfChapter(ch.id) * 2 + 2,
    })),
    onPick: (spec) => void openChapter(spec.id),
  });
  shell.attachMarks(marks);

  /* 翻页时：绑定页在正在翻的纸上的书签，跟纸共享同一个角度（每帧） */
  const pagesOfSheet = (sheet) => [
    Number(sheet.front.firstElementChild?.dataset.globalPage || 0),
    Number(sheet.back.firstElementChild?.dataset.globalPage || 0),
  ];
  sheets.hooks.onAngle = (sheet, deg) => {
    marks.riding({ pages: pagesOfSheet(sheet), deg });
  };

  const blankPage = () => null;

  /** 全局页码 → 页面节点：第 1 页是扉页，正文从第 2 页开始 */
  async function resolvePage(n) {
    if (n === 1) return titlePage;
    if (n < 1) return blankPage();
    if (inner) {
      if (n === 2) return inner.left;
      if (n === 3) return inner.right;
      return blankPage();
    }
    return book.pageByNumber(n);
  }

  const maxPage = () => book.totalSpreads() * 2 + 1;

  function pagesHere() {
    if (position.single) return [position.value, position.value];
    return [position.value * 2 + 2, position.value * 2 + 3];
  }

  function chapterOfPosition() {
    if (inner) return 'dishDetail';
    const list = book.spreads();
    const sp = list[position.single ? Math.floor((position.value - 2) / 2) : position.value];
    return sp ? sp.chapter : 'dishes';
  }

  async function render({ animate = null, ms } = {}) {
    if (animate) {
      const old = position.value;
      const ok = await sheets.turn(animate, {
        resolve: resolvePage,
        spread: position.single ? old - 1 : old,
        single: position.single,
        ms,
      });
      if (!ok) return false;
      position.value = old + (animate === 'next' ? 1 : -1);
    } else {
      await sheets.settle({ resolve: resolvePage, spread: position.single ? position.value - 1 : position.value, single: position.single });
    }
    marks.idle();
    syncChrome();
    return true;
  }

  /* ---------------- 页脚 / 页码 / 导航条 ---------------- */
  const pad2 = (n) => String(n).padStart(2, '0');

  function chapterLabelOfPage(n) {
    if (inner) return '菜品详情';
    if (n <= 1) return '';
    const list = book.spreads();
    const sp = list[Math.floor((n - 2) / 2)];
    if (!sp) return '';
    const ch = chapterById(sp.chapter);
    return ch ? ch.label : '';
  }

  function folioOfPage(n) {
    const label = chapterLabelOfPage(n);
    if (!label || n < 2) return '';
    return `${label} · P${pad2(n)}`;
  }

  function syncChrome() {
    const list = book.spreads();
    const chapterId = chapterOfPosition();
    shell.content.dataset.chapter = chapterId;
    currentKey = inner ? 'dishDetail' : chapterId;

    const [l, r] = pagesHere();
    if (position.single) shell.setFolio('', folioOfPage(position.value));
    else shell.setFolio(folioOfPage(l), folioOfPage(r));

    shell.setActive(chapterId);
    updateBackLabel();
    updatePager();

    // 地址跟着书页走：翻到哪一章，地址就是那一章
    const ch = chapterById(chapterId);
    if (ch && !inner && mode === 'open') {
      const href = chapterHrefOfPage(position.single ? position.value : position.value * 2 + 2, ch);
      if (href && location.pathname !== href) history.replaceState({ path: href }, '', href);
    }
    return list;
  }

  /** 同一章可能有多个地址（菜系 / 口味带 id）：翻页时保留当前 id */
  function chapterHrefOfPage(n, ch) {
    if (!ch) return null;
    if (ch.id === 'cuisines' || ch.id === 'tastes') {
      const cur = location.pathname.startsWith(ch.href.split('/').slice(0, 2).join('/')) ? location.pathname : ch.href;
      return cur;
    }
    return ch.href;
  }

  function updatePager() {
    const total = book.totalSpreads();
    if (position.single) {
      shell.prevBtn.disabled = position.value <= 2;
      shell.nextBtn.disabled = position.value >= maxPage();
      return;
    }
    shell.prevBtn.disabled = position.value <= 0;
    shell.nextBtn.disabled = position.value >= total - 1;
  }

  function updateBackLabel() {
    const label = shell.backBtn.querySelector('.bk-back__label');
    const isDetail = currentKey === 'dishDetail';
    shell.backBtn.dataset.action = isDetail ? 'gallery' : 'close';
    shell.backBtn.setAttribute('aria-label', isDetail ? '返回图鉴' : '合上画册');
    if (label) label.textContent = isDetail ? '返回图鉴' : '合上';
  }

  /* ---------------- 开书 ---------------- */
  let coverBusy = false;
  shell.cover.addEventListener('click', () => void openFirst());
  shell.cover.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void openFirst();
    }
  });

  async function openFirst() {
    if (phase !== 'CLOSED_TILTED' || busy) return;
    busy = true;
    try {
      // 先把页码定下来：书页展开的瞬间就有页脚
      const startSpread = book.spreadOfPath(location.pathname || '/dishes');
      const first = startSpread * 2 + 2;
      shell.setFolio(folioOfPage(first), folioOfPage(first + 1));

      setPhase('OPENING');
      setBookState('bk-book--opening');
      await wait(CHROME_MS);
      blendShadowTo(1, 520);
      shell.el.classList.add('is-open');
      setPhase('EXPANDING');
      await wait(OPEN_MS - CHROME_MS);
      setPhase('READING');
      setBookState('bk-book--reading');
      mode = 'open';
      await showPath(location.pathname || '/dishes', { flip: false });
    } finally {
      busy = false;
    }
  }

  /* ---------------- 显示某个路径 ---------------- */
  const INNER_KEYS = new Set(['dishDetail', 'admin', 'notFound']);

  async function showPath(path, { flip = false } = {}) {
    const info = moduleOf(path);
    const isInner = INNER_KEYS.has(info.key);

    if (isInner) {
      // 内页：单独一叠纸，左右两页都来自这个模块
      const entry = await book.innerPages(path);
      void book.disposeInner(inner);
      inner = entry;
      position = { single: lastBox.mode === 'single', value: lastBox.mode === 'single' ? 2 : 0 };
      await render();
      return;
    }

    void book.disposeInner(inner);
    inner = null;

    const target = book.spreadOfPath(path);
    const single = lastBox?.mode === 'single';
    const value = single ? target * 2 + 2 : target;

    // 尺寸模式变了（横竖屏）：重新摆一次纸，不做动画
    const modeChanged = single !== position.single;
    position = { single, value };

    if (flip && !modeChanged && Math.abs(target - (single ? 0 : 0)) >= 0) {
      await render();
      return;
    }
    await render();
  }

  /** 筛选变了：页数可能变化，重新摆纸 */
  async function refreshAtlas() {
    if (inner || position.single || currentKey !== 'dishes') return;
    const total = book.totalSpreads();
    position.value = Math.min(position.value, Math.max(0, total - 1));
    await render();
  }

  /** 横竖屏切换：单页 ↔ 双页，页码换算后重新摆纸 */
  async function reflow() {
    if (mode !== 'open') return;
    const single = lastBox.mode === 'single';
    if (single === position.single) return;
    const page = position.single ? position.value : position.value * 2 + 2;
    position = single ? { single: true, value: page } : { single: false, value: Math.floor((page - 2) / 2) };
    await render();
  }

  /* ---------------- 翻页 ---------------- */
  async function turn(dir) {
    if (mode !== 'open' || busy || inner) return;
    const step = dir === 'next' ? 1 : -1;
    const next = position.value + step;
    if (position.single) {
      if (next < 2 || next > maxPage()) return;
    } else if (next < 0 || next >= book.totalSpreads()) {
      return;
    }
    busy = true;
    try {
      await render({ animate: dir });
    } finally {
      busy = false;
    }
  }

  shell.prevBtn.addEventListener('click', () => void turn('prev'));
  shell.nextBtn.addEventListener('click', () => void turn('next'));

  /* ---------------- 章节跳转（书签） ---------------- */

  /**
   * 书签点击：先把书翻开（若合着），再一张一张真实地翻过去。
   * 距离近就整段翻；距离远就先翻两张真纸、剩下的直接落位（画册快速翻章的感觉），
   * 不会出现「书已经翻完、书签还停在原处」的错位。
   */
  async function openChapter(id) {
    const chapter = chapterById(id);
    if (!chapter) return;
    if (mode === 'closed') {
      await openFirst();
      if (mode !== 'open') return;
    }
    if (busy) return;
    busy = true;
    try {
      const single = lastBox.mode === 'single';
      const target = book.spreadOfChapter(id);
      const targetValue = single ? target * 2 + 2 : target;
      void book.disposeInner(inner);
      inner = null;
      if (position.single !== single) position = { single, value: single ? (position.value * 2 + 2) : Math.floor((position.value - 2) / 2) };

      let steps = 0;
      const maxSteps = 3;
      while (position.value !== targetValue && steps < maxSteps) {
        const dir = targetValue > position.value ? 'next' : 'prev';
        const ok = await render({ animate: dir, ms: 300 });
        if (!ok) break;
        steps += 1;
      }
      if (position.value !== targetValue) {
        position = { single, value: targetValue };
        await render();
      }
      history.pushState({ chapter: id }, '', location.pathname.startsWith(chapter.href) ? location.href : chapter.href);
    } finally {
      busy = false;
    }
  }

  /* 书签点击已在 createBookmarks 内部绑定，这里不再重复绑定 */

  /* ---------------- 合上 ---------------- */
  async function shut() {
    if (mode !== 'open' || busy) return;
    busy = true;
    try {
      setPhase('SHRINKING');
      setBookState('bk-book--open');
      await wait(520);
      setPhase('CLOSING');
      blendShadowTo(0, 520);
      setBookState('bk-book--straight');
      shell.el.classList.remove('is-open');
      await wait(720);
      setBookState('bk-book--closed');
      setPhase('CLOSED_TILTED');
      mode = 'closed';
      await wait(420);
    } finally {
      busy = false;
    }
  }
  shell.backBtn.addEventListener('click', () => {
    if (shell.backBtn.dataset.action === 'gallery') {
      history.pushState({ path: '/dishes' }, '', '/dishes');
      void showPath('/dishes');
      return;
    }
    void shut();
  });

  /* ---------------- 印章面板 ---------------- */
  let panelOpen = false;
  const setPanel = (next) => {
    panelOpen = next;
    shell.sealPanel.classList.toggle('is-open', next);
    shell.sealBtn.setAttribute('aria-expanded', String(next));
  };
  shell.sealBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setPanel(!panelOpen);
  });
  document.addEventListener('click', (e) => {
    if (panelOpen && !shell.sealPanel.contains(e.target) && e.target !== shell.sealBtn) setPanel(false);
  });

  mountAccount(shell.sealPanel);

  /* ---------------- 链接拦截 ---------------- */
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-link]');
    if (!link) return;
    const url = new URL(link.href, location.origin);
    if (url.origin !== location.origin) return;
    // 书页里的链接是模块自己渲染的，翻页纸里也能点
    e.preventDefault();
    if (busy) return;
    const path = url.pathname + url.search;
    if (mode === 'closed') {
      history.pushState({ path }, '', path);
      shell.setActive(chapterOf(path));
      return;
    }
    void showPath(path);
    history.pushState({ path }, '', path);
  });

  window.addEventListener('popstate', () => {
    if (busy) return;
    const path = location.pathname + location.search;
    if (mode === 'closed') {
      shell.setActive(chapterOf(path));
      return;
    }
    void showPath(path, { flip: false });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (panelOpen) return setPanel(false);
      if (mode === 'open') return void shut();
    }
    if (mode !== 'open') return;
    if (e.key === 'ArrowRight') void turn('next');
    if (e.key === 'ArrowLeft') void turn('prev');
  });

  /*
   * ---------------- 初始：合上的书 ----------------
   * 进站永远停在 CLOSED_TILTED：不读 location 自动开书、没有定时器、
   * 不监听 load / 图片加载 / visibilitychange 去开书。
   * 开书只有一个入口——用户点击（或键盘 Enter/Space）封面。
   */
  shell.setActive(chapterOf(location.pathname));
  setBookState('bk-book--closed');

  /** 首开预热：书签、返回键、翻页键平时隐藏，第一次点封面时才在 760ms 那一刻上屏 */
  function warmOpenChrome() {
    if (mode !== 'closed' || busy || phase !== 'CLOSED_TILTED') return;
    const els = [...shell.el.querySelectorAll('.bk-marks, .bk-back, .bk-turn')];
    if (!els.length) return;
    shell.el.classList.add('is-open');
    for (const el of els) el.style.opacity = '0.01';
    void shell.el.offsetWidth;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        for (const el of els) el.style.removeProperty('opacity');
        shell.el.classList.remove('is-open');
        void shell.el.offsetWidth;
      })
    );
  }
  window.setTimeout(warmOpenChrome, 600);

  window.__book = {
    build: 'sheet-2.1',
    get mode() {
      return mode;
    },
    get chapter() {
      return currentKey;
    },
    get spread() {
      return position.value;
    },
    get sheets() {
      return sheets;
    },
    get pages() {
      return book;
    },
    open: openFirst,
    shut,
    goto: (path) => showPath(path),
    turn,
    inspect: () => sheets.inspect(),
    shell,
  };

  return {
    shell,
    destroy() {
      stopObserve();
    },
  };
}