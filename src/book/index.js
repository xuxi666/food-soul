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
    syncMarks();
    fitMarks();
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
  let bookStateClass = 'bk-book--closed';
  /* 开书动画进入「页已摊开」阶段后为 true：书签据此落到各自绑定的纸张上 */
  let marksOpen = false;
  function setBookState(cls) {
    bookStateClass = cls;
    shell.book.className = `bk-book ${cls}`;
    if (shell.shadow) shell.shadow.className = `bk-shadow ${cls.replace('bk-book--', 'bk-shadow--')}`;
    followShadow();
    shell.el.classList.toggle('is-reading', cls === 'bk-book--reading');
    // 合上 / 打开：书签按纸张归属重排（合上时全部回右侧）
    syncMarks();
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
      h('p', { class: 'bk-titlepage__note', text: '左页书签翻章' })
    )
  );

  const book = createPageBook({
    staging: shell.staging,
    onAtlasChange: () => void refreshAtlas(),
  });
  const sheets = createSheets(shell.content);

  /*
   * 章节书签：一枚书签绑一张真实的纸。
   * anchorPage 取的是这一章第一跨页的「右页」（2*spread+3）——
   * 这样读到这一章时，这张纸还在右侧（未翻），书签就在右边；
   * 继续往后翻，这张纸被翻到左边，书签自然跟着到左侧，符合实物画册。
   * 书签上不印页码，页码只作为定位数据存在。
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

  // var：让 fit() 在书签创建之前调用 syncMarks() 时安全地拿到空值（function 作用域提升）
  var marksApi = null;
  const marks = createBookmarks({
    list: CHAPTERS.map((ch) => {
      const spread = book.spreadOfChapter(ch.id);
      return {
        id: ch.id,
        label: MARK_LABEL[ch.id] || ch.label,
        tint: MARK_TINT[ch.id] || '#b5452f',
        spread,
        anchorPage: spread * 2 + 3,
      };
    }),
    onPick: (spec) => void openChapter(spec.id),
  });
  shell.attachMarks(marks);
  marksApi = marks;
  requestAnimationFrame(() => fitMarks());

  function syncMarks() {
    if (!marksApi) return;
    const onSheet = pageSheetLookup();
    const current = position.value;
    // 合上 / 正在开合：所有书签都在右侧书口；只有真正摊开（open/reading）才按纸张分左右
    const spread = marksOpen || bookStateClass === 'bk-book--open' || bookStateClass === 'bk-book--reading';
    const closed = !spread || (mode === 'closed' && !marksOpen);
    marksApi.sync({
      closed,
      single: !!position.single,
      settling: !sheets.busy,
      /*
       * 书签的角度 = 它绑定那张纸的角度。
       * 1) 这一页正压在纸页栈里的某张纸（当前窗口）上 → 直接读那张纸的实时角度，
       *    翻页动画中每帧都是真值，书签就跟着纸一起转过去；
       * 2) 这一页已经被翻走、落到左侧的已翻纸堆里 → -180°，书签在左侧；
       * 3) 这一页还在右侧未翻的纸堆里 → 0°，书签在右侧。
       */
      angleFor: (spec) => {
        const hit = onSheet(spec.anchorPage);
        if (hit) return hit;
        if (spec.spread < current) return { angle: -180, slot: 'turned' };
        if (spec.spread > current) return { angle: 0, slot: 'unread' };
        return { angle: 0, slot: 'current' };
      },
    });
  }

  function pageSheetLookup() {
    const map = new Map();
    for (const sheet of sheets.all()) {
      for (const face of [sheet.front, sheet.back]) {
        const page = Number(face.firstElementChild?.dataset.globalPage || 0);
        if (page) map.set(page, { angle: sheet.angle, slot: sheet.slot });
      }
    }
    return (page) => map.get(page) || null;
  }

  /* 翻页每一帧：按纸张的实时角度重排书签（书签的联动杆就是这个角度） */
  sheets.hooks.onAngle = () => syncMarks();
  syncMarks();

  /**
   * 合上时书签要沿封面右侧那条书口排开：
   * 书口长度 = 书高（合上时整体缩到 CLOSED_SCALE），书签列的自然高度是固定像素，
   * 两者一比就知道该放大/缩小多少，保证上端不出书角、下端不落到书外。
   * 一切都是相对书本体的，窗口变化时 fit() 会重算。
   */
  const CLOSED_SCALE = 0.52;
  function fitMarks() {
    if (!marksApi || !lastBox) return;
    const layer = marksApi.layer;
    const bookH = lastBox.h;
    if (!bookH) return;
    // 1) 先按书页高度收字号：书小时书签跟着收，保证整列不越过书页上下沿
    const BASE = 12.5;
    shell.el.style.setProperty('--mk-font', `${BASE}px`);
    shell.el.style.setProperty('--mk-pad', '13px');
    shell.el.style.setProperty('--mk-gap', '6px');
    let h = layer.offsetHeight || 0;
    if (!h) return;
    const target = bookH * 0.94;
    // 1) 书小时先收字号
    if (h > target) {
      const fs = Math.max(8.5, BASE * (target / h));
      shell.el.style.setProperty('--mk-font', `${fs.toFixed(2)}px`);
      h = layer.offsetHeight || h;
    }
    // 2) 还不够就收内边距和间距（竖排文字的高度主要由这两项撑起来）
    let pad = 13;
    let gap = 6;
    while (h > target && pad > 5) {
      pad = Math.max(5, pad - 2);
      gap = Math.max(2, gap - 1);
      shell.el.style.setProperty('--mk-pad', `${pad}px`);
      shell.el.style.setProperty('--mk-gap', `${gap}px`);
      h = layer.offsetHeight || h;
    }
    // 2) 合上时再按封面书口长度放大：整列正好落在封面右缘那条书口上
    const fore = bookH * CLOSED_SCALE;
    const native = (layer.offsetHeight || h) * CLOSED_SCALE;
    const scale = Math.min(1.35, Math.max(0.78, (fore * 0.92) / native));
    shell.el.style.setProperty('--mk-scale', scale.toFixed(3));
  }

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
    syncMarks();
    syncChrome();
    return true;
  }

  /* ---------------- 页码：只保留内部索引，界面上不再显示 ---------------- */
  // 页码仍由 pages.js / position 维护，用于书签锚点与翻页定位；
  // 纸面、页脚、四角都不再渲染任何页码文字。

  function syncChrome() {
    const list = book.spreads();
    const chapterId = chapterOfPosition();
    shell.content.dataset.chapter = chapterId;
    currentKey = inner ? 'dishDetail' : chapterId;

    shell.setActive(chapterId);
    updateBackLabel();

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

  async function openFirst(targetSpread) {
    if (phase !== 'CLOSED_TILTED' || busy) return;
    busy = true;
    try {
      const single = lastBox.mode === 'single';
      const path = location.pathname || '/dishes';
      const innerTarget = INNER_KEYS.has(moduleOf(path).key);
      /*
       * 预定位：先把纸张摆到目标跨页，再开书。
       * 这样封面一掀开，看到的就是目标章节那一跨页的正反面内容，
       * 开书过程中不需要再翻一次、也不会先露出首页。
       */
      const spread = typeof targetSpread === 'number' ? targetSpread : book.spreadOfPath(path);
      const value = single ? spread * 2 + 2 : spread;
      void book.disposeInner(inner);
      inner = null;
      position = { single, value };
      await render({});

      /*
       * 纸张先全部合回 0°：书合着，全被封面挡着，看不见。
       * 接着 fan() 在开书动画期间把它们各自旋转到应在的角度 ——
       * 书签绑在纸上，于是跟着自己的纸从右书口一路转到目的地，
       * 全程没有「书打开了书签才跳过去」的瞬移。
       */
      sheets.collapse();

      // 页码在书页展开的瞬间就是目标页的
      const [left, right] = pagesHere();

      // 让刚贴上去的页面先完成一次布局，动画第一帧不会卡
      await wait(32);
      setPhase('OPENING');
      setBookState('bk-book--opening');
      marksOpen = true;
      syncMarks();
      const fanning = sheets.fan(OPEN_MS - 160);
      await wait(CHROME_MS);
      blendShadowTo(1, 520);
      shell.el.classList.add('is-open');
      setPhase('EXPANDING');
      await wait(Math.max(0, OPEN_MS - CHROME_MS - 80));
      await fanning;
      setPhase('READING');
      setBookState('bk-book--reading');
      mode = 'open';
      syncChrome();
      syncMarks();
      // 内页（菜品详情 / 后台等）仍然走模块页
      if (innerTarget) await showPath(path, { flip: false });
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

  /* ---------------- 章节跳转（书签） ---------------- */

  /**
   * 书签点击：
   * - 书合着 → 先算出这个书签绑定的章节跨页，把它预先摆成纸张内容，再执行「一次」开书动画；
   *   动画结束时书就停在目标章节上，不经过首页，也不再有第二次翻页。
   * - 书已经打开 → 按真实纸张一页一页翻过去（书签跟着各自的纸张动），
   *   距离超出纸页栈范围时再落位。
   */
  /* 动画途中又点了别的书签：记下最后一个，当前这段动画走完再接着去（不会竞态、不会丢点击） */
  let pendingChapter = null;
  function flushPendingChapter() {
    const id = pendingChapter;
    pendingChapter = null;
    if (!id) return;
    setTimeout(() => void openChapter(id), 0);
  }

  async function openChapter(id) {
    const chapter = chapterById(id);
    if (!chapter) return;
    if (busy) { pendingChapter = id; return; }
    const target = book.spreadOfChapter(id);

    if (mode === 'closed') {
      if (phase !== 'CLOSED_TILTED') return;
      await openFirst(target);
      if (mode !== 'open') return;
      history.replaceState({ chapter: id }, '', location.pathname.startsWith(chapter.href) ? location.href : chapter.href);
      flushPendingChapter();
      return;
    }
    busy = true;
    try {
      const single = lastBox.mode === 'single';
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
      flushPendingChapter();
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
      pendingChapter = null;
      marksOpen = false;
      syncMarks();
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
    const els = [...shell.el.querySelectorAll('.bk-marks, .bk-back')];
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
    /* 书签当前绑在哪张纸、在哪一侧（诊断 / 验收用） */
    marks: () => (marksApi ? marksApi.state() : []),
    syncMarks,
    shell,
  };

  return {
    shell,
    destroy() {
      stopObserve();
    },
  };
}