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
import { createSheets, TURN_MS } from './sheets.js';
import { createBookmarks } from './bookmarks.js';
import { computeLayout, observeLayout } from './layout.js';
import { mountAccount } from '../components/account.js';
import './book.css';
import './atlas.css';
import './dish-page.css';
import './category.css';
import './catalog.css';
import './video-panel.css';
import { closeAllOverlays } from './overlay.js';
import {
  RECIPE_NAV_EVENT,
  peekRecipeNav,
  recipeHref,
  setRecipeNavigator,
} from './recipe-nav.js';
import {
  cancelRevisit,
  currentEntry,
  expectRevisit,
  historyState,
  moduleNameOf,
  previousEntry,
  recordNavigation,
  restoreCursor,
  revisitPending,
} from './nav.js';
import {
  closeDishChat,
  dishChatState,
  hasOpenDishChat,
  openDishChatDishId,
  openDishChatPanel,
  setDishChatOpener,
} from './chat-panel.js';
import {
  closeDishVideo,
  dishVideoState,
  hasOpenDishVideo,
  openDishVideoDishId,
  openDishVideoPanel,
  setDishVideoOpener,
} from './video-panel.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function initBook({ root, routerApi = null }) {
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
  /**
   * 「生成菜谱」入口的翻页时长：比通用翻页（TURN_MS 680ms）快 30%。
   * 只作用于菜谱统一导航；书签翻章、普通翻页仍是 TURN_MS。
   */
  const RECIPE_TURN_MS = Math.round(TURN_MS * 0.7);
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
  /** 内页种类：dishDetail / admin / notFound */
  let innerKind = null;
  /** 进后台之前的画册位置：退出后台时原样回到这一页 */
  let adminReturn = null;

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
    // 图鉴卡片的三角书签：直接走全局章节导航（和右侧实体书签同一条路径），
    // 目标分类在翻页开始前就定好，落地即目标页，不再二次切换
    onCategoryNav: (kind, id) => openChapterAt(kind, id),
    // 目录条目的点击：和侧边书签共用 openChapter（同一套翻页控制，同一份章节映射）
    onChapterNav: (id) => void openChapter(id),
  });
  const sheets = createSheets(shell.content);

  /* 统一导航层的状态（书签 / 返回 / 站内页共用） */
  let suppressHistory = false;   // 站内页回来时的中间落位不入历史
  let parkedSite = null;         // 寄存中的站内页（聊天）
  let pendingReenter = null;     // 忙时的最后一次书签请求
  let backRetry = 0;
  let lastChromeChapter = null;   // 上一次落地的章节：只在「真的换章」时通知模块

  /** 中间落位（换纸 / 翻页中）不记历史；可嵌套，内层结束不提前恢复 */
  async function withoutHistory(fn) {
    const prev = suppressHistory;
    suppressHistory = true;
    try {
      return await fn();
    } finally {
      suppressHistory = prev;
    }
  }

  /** 每次落到新页面记一笔历史：模块 + 地址 + 参数 + 内部状态 + 滚动位置 */
  function recordBookVisit(chapterId) {
    if (mode !== 'open') return;
    const id = inner ? innerKind || 'dishDetail' : chapterId;
    recordNavigation({
      moduleId: id,
      moduleName: moduleNameOf(id),
      route: location.pathname + location.search,
      params: { chapter: chapterId, spread: position.value, single: position.single },
      pageState: { inner: !!inner, single: position.single },
      scrollPosition: window.scrollY || 0,
    });
  }

  /*
   * 章节书签：一枚书签绑一张真实的纸。
   * anchorPage 取的是这一章第一跨页的「右页」（2*spread+3）——
   * 这样读到这一章时，这张纸还在右侧（未翻），书签就在右边；
   * 继续往后翻，这张纸被翻到左边，书签自然跟着到左侧，符合实物画册。
   * 书签上不印页码，页码只作为定位数据存在。
   *
   * 书签的名字与色标、目录页的条目与名称，都来自 chapters.js 的同一份 CHAPTERS：
   * 两边只认章节 id，不允许各写一套。
   */
  // var：让 fit() 在书签创建之前调用 syncMarks() 时安全地拿到空值（function 作用域提升）
  var marksApi = null;
  const marks = createBookmarks({
    list: CHAPTERS.map((ch) => {
      const spread = book.spreadOfChapter(ch.id);
      return {
        id: ch.id,
        label: ch.label,
        tint: ch.tint,
        spread,
        anchorPage: spread * 2 + 3,
      };
    }),
    // 书签：统一走 goBookmark（书开着就翻页；站内页上先把纸张挂回来再翻）
    onPick: (spec) => void goBookmark(spec),
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
  /*
   * 合书尺寸、封面纵向拉伸、书签基准值都写在 CSS 里（桌面/手机各一套），
   * 这里只读，不在 JS 里另存一份常数，避免两边数值走散。
   */
  function cssNum(name, fallback) {
    const el = shell.book || shell.el;
    const v = parseFloat(getComputedStyle(el).getPropertyValue(name));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  }

  function fitMarks() {
    if (!marksApi || !lastBox) return;
    const layer = marksApi.layer;
    const bookH = lastBox.h;
    if (!bookH) return;
    const closedScale = cssNum('--closed-scale', 0.585);
    const stretch = cssNum('--closed-cover-stretch', 1.06);
    // 1) 先按书页高度收字号：书小时书签跟着收，保证整列不越过书页上下沿
    const BASE = cssNum('--mk-base-font', 14.5);
    const basePad = cssNum('--mk-base-pad', 11);
    const baseGap = cssNum('--mk-base-gap', 6);
    shell.el.style.setProperty('--mk-font', `${BASE}px`);
    shell.el.style.setProperty('--mk-pad', `${basePad}px`);
    shell.el.style.setProperty('--mk-gap', `${baseGap}px`);
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
    let pad = basePad;
    let gap = baseGap;
    while (h > target && pad > 5) {
      pad = Math.max(5, pad - 2);
      gap = Math.max(2, gap - 1);
      shell.el.style.setProperty('--mk-pad', `${pad}px`);
      shell.el.style.setProperty('--mk-gap', `${gap}px`);
      h = layer.offsetHeight || h;
    }
    // 3) 合上时按「封面书口长度」放大：整列正好落在封面右缘那条书口上
    //    封面在合上时额外纵向拉长 stretch，书口长度也要跟着算进去。
    const fore = bookH * closedScale * stretch;
    const native = (layer.offsetHeight || h) * closedScale;
    const scale = Math.min(2.2, Math.max(0.78, (fore * 0.92) / native));
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
    if (inner) return innerKind || 'dishDetail';
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
    currentKey = inner ? innerKind || 'dishDetail' : chapterId;

    shell.setActive(chapterId);
    // 目录页里高亮的是同一份章节 id：读到哪一章，目录里那一行就是当前章
    book.setChapterActive?.(chapterId);
    // 已经在目录页时不再显示「回到目录」
    shell.el.classList.toggle('is-on-catalog', chapterId === 'catalog');

    // 地址跟着书页走：翻到哪一章，地址就是那一章
    const ch = chapterById(chapterId);
    if (ch && !inner && mode === 'open') {
      const href = chapterHrefOfPage(position.single ? position.value : position.value * 2 + 2, ch);
      if (href && location.pathname !== href) history.replaceState({ path: href }, '', href);
    }
    if (!suppressHistory) recordBookVisit(chapterId);
    // 普通进入菜谱章（书签 / 目录 / 翻页）：如果输入框里是上一次「生成菜谱」留下的名字，
    // 通知菜谱页收回去 —— 书签进入不该带着上一道菜（用户自己改过的名字不受影响）
    if (chapterId === 'recipe' && chapterId !== lastChromeChapter && !inner && !peekRecipeNav()) {
      window.dispatchEvent(new CustomEvent('foodsoul:recipe-enter', { detail: { chapter: chapterId } }));
    }
    lastChromeChapter = chapterId;
    return list;
  }

  /** 同一章可能有多个地址（菜系 / 口味带 id）：翻页时保留当前 id */
  function chapterHrefOfPage(n, ch) {
    if (!ch) return null;
    if (ch.id === 'cuisines' || ch.id === 'tastes') {
      const root = ch.href.split('/').slice(0, 2).join('/');
      const param = book.getChapterParam?.(ch.id);
      return param ? `${root}/${param}` : ch.href;
    }
    return ch.href;
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
      const bootInfo = moduleOf(path);
      // 书签直接打开 /cuisines/yue、/tastes/qingxian：先把分类 id 交给章节，再摆纸
      if (bootInfo.key === 'cuisines' || bootInfo.key === 'tastes') {
        book.setChapterParam?.(bootInfo.key, bootInfo.params?.[0]);
      }
      const innerTarget = INNER_KEYS.has(bootInfo.key);
      /*
       * 预定位：先把纸张摆到目标跨页，再开书。
       * 这样封面一掀开，看到的就是目标章节那一跨页的正反面内容，
       * 开书过程中不需要再翻一次、也不会先露出首页。
       */
      // 内页（后台 / 菜品详情）没有自己的章节跨页，先停在第一章再切到内页那一叠
      const spread =
        typeof targetSpread === 'number' ? targetSpread : innerTarget ? 0 : Math.max(0, book.spreadOfPath(path));
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

  /**
   * 站内页面（AI 聊天等）的转场会把内容层换掉，书页 DOM 跟着被卸掉，
   * 但画册状态还停在「开着」。这时再点书里的链接或按浏览器返回，
   * 在空壳上重建并不可靠 —— 直接整页重进，走深链接开书那条老路。
   */
  const bookDomGone = () => mode === 'open' && !document.querySelector('.bk-sheet');

  /* ---------------- 双页聊天：详情一页，聊天另一页 ---------------- */
  /**
   * 详情浮层 / 详情页所在的那张纸。
   * 图鉴的宿主是 .atlas-page，菜系 / 口味是 .bk-pageface，深链接详情是内页的右页。
   */
  function hostPageOf(el) {
    return (
      el?.closest?.('.atlas-page') ||
      el?.closest?.('.bk-pageface') ||
      document.querySelector('.atlas-detail')?.closest('.atlas-page, .bk-pageface') ||
      null
    );
  }

  /** 当前跨页的另一张纸（单页模式没有另一半，聊天就落在详情自己那页） */
  async function otherPageOf(host) {
    if (position.single) return { page: host, side: 'full', single: true };
    const [ln, rn] = pagesHere();
    const left = await resolvePage(ln);
    const right = await resolvePage(rn);
    if (host === left) return { page: right, side: 'right', single: false };
    if (host === right) return { page: left, side: 'left', single: false };
    return null;
  }

  /** 「和某某聊聊」：详情保持不动，聊天开在另一半页 */
  async function openDualChat(subject, originEl) {
    if (!subject?.id || mode !== 'open') return false;
    if (busy) return false;
    // 同一时刻另一半只放一个主要辅助面板：聊天打开前先收起视频
    closeDishVideo('chat', { instant: true });
    const host = hostPageOf(originEl);
    if (!host) return false;
    const slot = await otherPageOf(host);
    if (!slot?.page) return false;
    await openDishChatPanel({ subject, page: slot.page, side: slot.side, single: slot.single });
    return true;
  }

  /** 菜品详情「做菜视频」：详情留在原页，视频开在另一半页 */
  async function openDualVideo(dish, originEl) {
    if (!dish?.id || mode !== 'open') return false;
    if (busy) return false;
    const host = hostPageOf(originEl);
    if (!host) return false;
    const slot = await otherPageOf(host);
    if (!slot?.page) return false;
    // 视频与聊天互斥，先收起聊天；已打开同一个菜品时直接恢复/沿用已有结果
    closeDishChat('video', { instant: true });
    await openDishVideoPanel({
      dish,
      page: slot.page,
      side: slot.side,
      single: slot.single,
    });
    return true;
  }

  /* ---------------- 显示某个路径 ---------------- */
  const INNER_KEYS = new Set(['dishDetail', 'admin', 'notFound']);

  async function showPath(path, { flip = false } = {}) {
    const info = moduleOf(path);
    // 聊天 / 视频都是详情页的临时另一半：换路径就不该留着
    closeDishChat('nav');
    closeDishVideo('nav');
    // 是不是从「菜品详情」出发的：内页 / 图鉴里展开的详情浮层都算。
    // 必须在收起浮层之前判断，收起之后就看不出来了。
    const fromDetail = !!inner || shell.el.classList.contains('is-atlas-expanded');
    // 换章节 / 进内页：页内详情属于上一页，先原样收起
    if (info.key !== 'dishes') closeAllOverlays({ instant: true });
    // 菜系 / 口味带分类 id：地址说哪个就换哪个（书签、深链接、前进后退都走这里）
    if (info.key === 'cuisines' || info.key === 'tastes') book.setChapterParam?.(info.key, info.params?.[0]);
    const isInner = INNER_KEYS.has(info.key);

    // 进后台：先记住此刻的画册位置（章节 + 具体跨页），退出时原样回来
    if (info.key === 'admin' && innerKind !== 'admin') {
      adminReturn = {
        path: location.pathname + location.search,
        position: { ...position },
        chapter: currentKey,
      };
    }

    if (isInner) {
      // 内页：单独一叠纸，左右两页都来自这个模块（后台 = 左导航 / 右内容）
      const entry = await book.innerPages(path, { single: lastBox.mode === 'single' });
      void book.disposeInner(inner);
      inner = entry;
      innerKind = info.key;
      position = { single: lastBox.mode === 'single', value: lastBox.mode === 'single' ? 2 : 0 };
      // 内页要先换纸、再把地址改成自己的：中间那一帧不单独记历史，避免同一页记两次
      await withoutHistory(() => render());
      // 开书 / 换纸过程中 syncChrome 会把地址写成章节路径，内页要把自己的地址写回来
      if (location.pathname + location.search !== path) history.replaceState({ path }, '', path);
      syncChrome();
      return true;
    }

    const target = book.spreadOfPath(path);
    const single = lastBox?.mode === 'single';
    const value = single ? target * 2 + 2 : target;

    // 尺寸模式变了（横竖屏）：重新摆一次纸，不做动画
    const modeChanged = single !== position.single;
    const fromValue = position.value;

    // 从菜品详情（内页 / 图鉴浮层）跳到后面的章节：真翻一页，
    // 翻起来的那张纸背面就已经是目标章，落地即到，不再有一次硬切。
    if (!modeChanged && !single && fromDetail && target > fromValue) {
      busy = true;
      try {
        const turned = await flipFromDetailTo(target, fromValue);
        if (turned) {
          position = { single, value };
          await render();
          syncChrome();
          return true;
        }
      } finally {
        busy = false;
      }
    }

    // 没走翻页（横竖屏切换 / 目标在前 / 纸正忙）：照旧原地换内容
    void book.disposeInner(inner);
    inner = null;
    innerKind = null;
    position = { single, value };
    await render();
    syncChrome();
    return true;
  }

  /**
   * 退出后台：回到进入后台之前的那一页（章节 + 跨页原样恢复）。
   * 普通章节的纸面在 pages.js 里是长期缓存的，所以筛选、滚动、输入都会还原。
   */
  async function leaveAdmin() {
    const saved = adminReturn;
    adminReturn = null;
    const target = saved?.path || '/dishes';
    void book.disposeInner(inner);
    inner = null;
    innerKind = null;
    const single = lastBox?.mode === 'single';
    if (saved?.position && saved.position.single === single) {
      position = { ...saved.position };
    } else {
      const at = book.spreadOfPath(target);
      position = { single, value: single ? at * 2 + 2 : at };
    }
    await render();
    history.pushState({ path: target }, '', target);
    shell.setActive(chapterOf(target));
    syncChrome();
  }

  window.addEventListener('foodsoul:admin-leave', () => {
    if (currentKey !== 'admin' && innerKind !== 'admin') return;
    void leaveAdmin();
  });

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
    // 目录页在单页 / 双页下是两种排法（并页 / 分页），换模式时按新宽度重建一次
    book.disposeChapter?.('catalog');
    await render();
  }

  /* ---------------- 翻页 ---------------- */
  async function turn(dir) {
    if (mode !== 'open' || busy || inner) return;
    // 图鉴正在页内展开详情：这一页属于局部动画，整本翻页要等它收起
    if (shell.el.classList.contains('is-atlas-expanded')) return;
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
    const next = pendingChapter;
    pendingChapter = null;
    if (!next) return;
    setTimeout(() => void openChapter(next.id, next.param, next.opts), 0);
  }

  /** 同一章可能有多个地址（菜系 / 口味带分类 id）：地址要和内容一起对准 */
  function chapterHrefFor(id, param) {
    const ch = chapterById(id);
    if (!ch) return '/dishes';
    if ((id === 'cuisines' || id === 'tastes') && param) {
      return `${ch.href.split('/').slice(0, 2).join('/')}/${param}`;
    }
    return ch.href;
  }

  /**
   * 翻页前先把四张纸正反面的内容按「当前参数 + 目标参数」重贴一遍。
   * 下一张纸的背面是翻页途中唯一会露出的「新内容」，
   * 不刷新就会出现「翻到一半还是旧分类、落地后才换」。
   */
  async function prefillFaces() {
    await sheets.settle({
      resolve: resolvePage,
      spread: position.single ? position.value - 1 : position.value,
      single: position.single,
      keepAngles: true,
    });
  }

  /**
   * 从菜品详情（内页 / 图鉴浮层）翻到某一章：只翻一页。
   *
   * 书是「四张纸」的物理模型：翻动的那张纸背面、以及它下面那张的正面，
   * 就是翻页途中唯一会露出来的内容。所以先把这两面换成目标章左右两页，
   * 当前跨页原样不动，再真翻一页；sheets.turn 收尾会按目标跨页把四张纸重贴一遍，
   * 落地正好是目标章，不需要再加一次「瞬移」。
   *
   * @param {number} targetSpread 目标跨页下标（双页模式）
   * @param {number} fromValue    此刻屏幕停在哪一跨页
   * @returns {Promise<boolean>}  是否真的翻了（false 时调用方走原来的硬切）
   */
  async function flipFromDetailTo(targetSpread, fromValue, ms = TURN_MS) {
    if (position.single || targetSpread <= fromValue) return false;
    const left = await book.pageByNumber(targetSpread * 2 + 2);
    const right = await book.pageByNumber(targetSpread * 2 + 3);
    if (!left || !right) return false;
    // 当前跨页的两页（含）保持原样：内页还显示着，不能提前被换掉
    const keepUpTo = fromValue * 2 + 3;
    // 翻页时只会露出这两面：翻动纸的背面（左）+ 它下面那张的正面（右）。
    // 其余页位一律给空白纸——同一种纸面节点只能挂在一个页位上，
    // 重复给同一张会把先贴好的那张挤走，翻到一半就露出白纸。
    const turnLeft = fromValue * 2 + 4;
    const turnRight = turnLeft + 1;
    const landing = (n) => (n === turnLeft ? left : n === turnRight ? right : blankPage());
    await sheets.settle({
      resolve: async (n) => (n <= keepUpTo ? resolvePage(n) : landing(n)),
      spread: fromValue,
      single: false,
      keepAngles: true,
    });
    // 内页等纸翻起来之后再拆：B 的正面正显示着它，提前拆会翻出一张白纸
    const gone = inner;
    inner = null;
    innerKind = null;
    const ok = await sheets.turn('next', { resolve: resolvePage, spread: targetSpread - 1, single: false, ms });
    if (gone) void book.disposeInner(gone);
    return ok;
  }

  /**
   * 图鉴卡片的三角书签 → 全局章节导航。
   * kind = cuisine / taste，id 用的是图鉴卡片上的真实分类 id（与章节同一份数据）。
   */
  function openChapterAt(kind, id) {
    const chapterId = kind === 'taste' ? 'tastes' : 'cuisines';
    // 用画册自己的翻页时长：一次真实的纸页翻动，不是书签式快进
    return openChapter(chapterId, id, { ms: TURN_MS });
  }

  /**
   * @param {string} id        章节 id
   * @param {string} [param]   目标分类 id（菜系 / 口味），缺省用该章默认分类
   * @param {{ms?: number}} [opts] 翻页时长，缺省 300（书签快进）；图鉴三角书签用 TURN_MS
   */
  async function openChapter(id, param, opts = {}) {
    const chapter = chapterById(id);
    if (!chapter) return;
    // 书签 / 目录 / 章节切换：临时聊天面板不能跟着漂到别的模块
    closeDishChat('nav');
    closeDishVideo('nav');
    if (busy) { pendingChapter = { id, param, opts }; return; }
    if (id !== 'dishes') closeAllOverlays({ instant: true });
    // 书签是章节入口：不带分类时回到该分类的默认代表（川菜 / 麻辣鲜香）
    const wanted = param || chapter.href.split('/')[2];
    book.setChapterParam?.(id, wanted);
    const target = book.spreadOfChapter(id);
    const href = chapterHrefFor(id, wanted);

    if (mode === 'closed') {
      if (phase !== 'CLOSED_TILTED') return;
      await openFirst(target);
      if (mode !== 'open') return;
      history.replaceState({ chapter: id }, '', location.pathname.startsWith(href) ? location.href : href);
      syncChrome();
      flushPendingChapter();
      return true;
    }
    busy = true;
    try {
      const single = lastBox.mode === 'single';
      const targetValue = single ? target * 2 + 2 : target;
      void book.disposeInner(inner);
      inner = null;
      if (position.single !== single) position = { single, value: single ? (position.value * 2 + 2) : Math.floor((position.value - 2) / 2) };

      await withoutHistory(async () => {
        // 已经就在目标分类上（例如连点两下同一枚书签）：换内容即可，不假装翻一页
        if (position.value === targetValue) {
          await prefillFaces();
          return;
        }
        let steps = 0;
        const maxSteps = 3;
        while (position.value !== targetValue && steps < maxSteps) {
          const dir = targetValue > position.value ? 'next' : 'prev';
          // 每翻一步之前都刷新一次正反面：这一步露出的背面就是目标页
          await prefillFaces();
          const ok = await render({ animate: dir, ms: opts.ms ?? 300 });
          if (!ok) break;
          steps += 1;
        }
        if (position.value !== targetValue) {
          position = { single, value: targetValue };
          await render();
        }
      });
      history.pushState({ chapter: id }, '', location.pathname === href ? location.href : href);
      // 翻页途中的中间跨页不算「访问过的模块」：落地后只记这一条
      syncChrome();
      return true;
    } finally {
      busy = false;
      flushPendingChapter();
    }
  }

  /* ---------------- 「生成菜谱」统一导航（画册侧） ---------------- */

  /** 书忙时先存着的那一条：只保留最后一次点击 */
  let pendingRecipeNav = null;

  function dispatchRecipeNav(payload) {
    window.dispatchEvent(new CustomEvent(RECIPE_NAV_EVENT, { detail: payload }));
  }

  /**
   * 开书 / 翻页还没走完：先排队，书闲下来再执行最后一次；
   * 超过约 4 秒还忙就放弃并记一笔，避免死等。
   */
  function queueRecipeNav(payload, attempt = 0) {
    pendingRecipeNav = payload;
    const run = (n) => {
      if (!pendingRecipeNav) return;
      if (busy) {
        if (n >= 45) {
          pendingRecipeNav = null;
          console.warn('[recipe-nav] 画册长时间忙碌，放弃本次菜名导航');
          return;
        }
        window.setTimeout(() => run(n + 1), 90);
        return;
      }
      const next = pendingRecipeNav;
      pendingRecipeNav = null;
      void goRecipeModule(next);
    };
    window.setTimeout(() => run(attempt), 90);
  }

  /**
   * 全站「生成菜谱」的画册实现（由 recipe-nav 注册，入口不直接调它）。
   *
   * - 书合着：按章节注册信息取出菜谱章跨页，走一次原有开书动画，落地就在菜谱页；
   * - 书开着：走画册自己的翻页（render({animate}) 一页一页翻，纸页 / 中缝都在）；
   * - 落地后写地址（带 dish / name / from，刷新与分享都能回填）并派发一次性任务。
   */
  async function goRecipeModule(payload) {
    if (!payload) return;
    /* 从图鉴浮层点过来：先收起浮层，别让它压在菜谱页上 */
    closeAllOverlays();
    const href = recipeHref(payload);
    const land = () => {
      if (location.pathname + location.search !== href) history.pushState({ path: href }, '', href);
      dispatchRecipeNav(payload);
    };

    if (mode === 'closed') {
      if (busy || phase !== 'CLOSED_TILTED') {
        queueRecipeNav(payload);
        return;
      }
      await openFirst(book.spreadOfChapter('recipe'));
      if (mode !== 'open') {
        queueRecipeNav(payload);
        return;
      }
      land();
      return;
    }

    if (busy) {
      queueRecipeNav(payload);
      return;
    }

    busy = true;
    try {
      const single = lastBox.mode === 'single';
      const target = book.spreadOfChapter('recipe');

      /*
       * 从菜品详情（内页 / 图鉴浮层）过来时走原有那条专门路径：
       * 只翻一页，翻起来那张纸的背面就是菜谱页，落地即到 —— 一次动画，最自然。
       */
      if (!single && inner && target > position.value) {
        const turned = await flipFromDetailTo(target, position.value, RECIPE_TURN_MS);
        if (turned) {
          position = { single, value: target };
          await render();
          syncChrome();
          land();
          return;
        }
      }

      const targetValue = single ? target * 2 + 2 : target;
      void book.disposeInner(inner);
      inner = null;
      innerKind = null;
      if (position.single !== single) {
        position = { single, value: single ? position.value * 2 + 2 : Math.floor((position.value - 2) / 2) };
      }

      if (position.value === targetValue) {
        await prefillFaces();
      }
      let steps = 0;
      while (position.value !== targetValue && steps < 3) {
        /* 每翻一页之前把正反面重贴一次：翻起来那张纸的背面就是菜谱页 */
        await prefillFaces();
        const dir = targetValue > position.value ? 'next' : 'prev';
        const ok = await render({ animate: dir, ms: RECIPE_TURN_MS });
        if (!ok) break;
        steps += 1;
      }
      if (position.value !== targetValue) {
        position = { single, value: targetValue };
        await render();
      }
      syncChrome();

      /*
       * 无条件落地：地址带上本次菜名参数（刷新 / 分享都能回填），并派发一次性任务。
       * 任务可能已经在菜谱模块挂载时被消费掉（首次进入），此时事件是空操作；
       * 页面已缓存时则由这次事件回填。点了别的菜的旧任务会被 navigationId 挡掉。
       */
      land();
    } finally {
      busy = false;
    }
  }

  /* ============================================================
   * 统一导航层：书签 / 返回 / 合上 / 站内页（聊天）
   * 书签最高优先级 —— 书开着时任何模块都能直接翻过去；
   * 返回只回上一页 / 上一模块，不再合书；合书只认「合上」按钮。
   * ============================================================ */

  function moduleIdOfRoute(route) {
    const p = String(route || '').split('?')[0];
    return p.startsWith('/chat') ? 'chat' : 'site';
  }

  /** 站内页（聊天等）本身也是历史里的一层 */
  function recordSiteVisit(route) {
    const id = moduleIdOfRoute(route);
    return recordNavigation({
      moduleId: id,
      moduleName: moduleNameOf(id),
      route,
      params: {},
      pageState: {},
      scrollPosition: window.scrollY || 0,
      site: true,
    });
  }

  /** 收进寄存盒：DOM 与视图实例都留着 —— 聊天记录、正在流式生成的回复都不会断 */
  function stashSitePage(route, nodes, instance) {
    const box = h('div', { class: 'bk-parked', 'aria-hidden': 'true' });
    box.hidden = true;
    for (const node of nodes) {
      node.classList.remove('is-park-leaving', 'is-park-out');
      box.append(node);
    }
    document.body.append(box);
    parkedSite = { route, box, instance, at: Date.now() };
    return parkedSite;
  }

  /** 立即整页寄存（合书这种没有翻页过程的路径） */
  function parkSitePage(route) {
    const nodes = [...shell.content.children];
    const instance = routerApi?.park?.() ?? null;
    sheets.detach();                    // 纸张整体摘下：站内页在时书页不在 DOM 里
    shell.el.classList.remove('is-site-page');
    return stashSitePage(route, nodes, instance);
  }

  /**
   * 离开站内页的准备：只交出视图所有权（不销毁），页面先留在原位并标成「正在淡出」，
   * 底下的书页才能一边摆位一边被看见 —— 不是「先藏旧页面再显示新页面」。
   */
  function releaseSitePage(route) {
    const nodes = [...shell.content.children];
    const instance = routerApi?.park?.() ?? null;
    for (const node of nodes) node.classList.add('is-park-leaving');
    shell.el.classList.remove('is-site-page');   // 书页重新可见（站内页此刻还盖在上面淡出）
    return { route, nodes, instance };
  }

  /** 翻页开始的同一拍：站内页淡出，露出正在翻动的纸 */
  function beginSiteFadeOut(released) {
    if (!released) return;
    for (const node of released.nodes) node.classList.add('is-park-out');
  }

  /** 接回寄存的站内页：不重新加载、不重建视图 */
  function restoreSitePage(route) {
    const park = parkedSite;
    if (!park) return false;
    for (const node of [...park.box.children]) {
      node.classList.remove('is-park-leaving', 'is-park-out');
      shell.content.append(node);
    }
    park.box.remove();
    parkedSite = null;
    sheets.detach();                    // 书页让位：站内页整页显示时纸张不进 DOM
    routerApi?.restore?.(park.instance, route || park.route);
    shell.el.classList.add('is-site-page');
    recordSiteVisit(route || park.route);
    return true;
  }

  /**
   * 站内页上点书签：四张纸挂回书里 → 摆到目标前一跨页 → 真翻一页过去。
   * 目标章节的内容和书签选中态由同一条 syncChrome 收尾，不另写跳转。
   */
  async function reenterFromSite({ id, param, path } = {}) {
    if (mode !== 'open') return false;
    if (busy) {
      pendingReenter = { id, param, path };
      return false;
    }
    busy = true;
    let released = null;
    try {
      const siteRoute = location.pathname + location.search;
      if (!parkedSite && !revisitPending()) recordSiteVisit(siteRoute);
      released = releaseSitePage(siteRoute);
      sheets.reattach(shell.content);
      void book.disposeInner(inner);
      inner = null;
      innerKind = null;
      closeAllOverlays({ instant: true });

      const chapter = id ? chapterById(id) : null;
      // 菜系 / 口味带分类：书签进来没有分类时，回到该章默认代表（与 openChapter 完全一致）
      const wanted = chapter ? param || chapter.href.split('/')[2] : undefined;
      if (chapter) book.setChapterParam?.(chapter.id, wanted);
      const target = path ? book.spreadOfPath(path) : book.spreadOfChapter(id);
      const single = lastBox.mode === 'single';
      const landValue = single ? target * 2 + 2 : target;
      const fromValue = single ? Math.max(2, landValue - 1) : Math.max(0, target - 1);

      const href = path || (chapter ? chapterHrefFor(chapter.id, wanted) : '/dishes');
      const isInnerTarget = !!path && INNER_KEYS.has(moduleOf(path).key);

      await withoutHistory(async () => {
        position = { single, value: fromValue };
        await render();
        if (landValue !== fromValue) {
          await prefillFaces();
          const turning = render({ animate: 'next' });
          await wait(24);
          beginSiteFadeOut(released);   // 纸开始翻的同一拍，站内页淡出
          await turning;
        } else {
          beginSiteFadeOut(released);
        }
        history.pushState({ path: href }, '', href);
        // 目标是内页（菜品详情 / 后台）：落章之后按既有换纸逻辑进内页
        if (isInnerTarget) await showPath(path, { flip: false });
      });

      if (released?.nodes.length) stashSitePage(siteRoute, released.nodes, released.instance);
      // 整段中间落位都不进历史；到这里才记这一次导航（翻页途中不出现中间条目）
      syncChrome();
      return true;
    } finally {
      if (released?.nodes.length && !parkedSite) {
        stashSitePage(released.route, released.nodes, released.instance);
      }
      suppressHistory = false;
      busy = false;
      const next = pendingReenter;
      pendingReenter = null;
      if (next) {
        window.setTimeout(() => {
          if (bookDomGone()) void reenterFromSite(next);
          else void openChapter(next.id, next.param);
        }, 0);
      } else if (pendingChapter) {
        // 站内页上连点不同书签：最后一次点击在书里等着，这里接着执行
        flushPendingChapter();
      }
    }
  }

  /** 书签点击：统一入口（书开着翻页；站内页上先挂回纸张再翻） */
  async function goBookmark(spec) {
    const chapter = chapterById(spec?.id);
    if (!chapter) return false;
    if (bookDomGone()) return reenterFromSite({ id: chapter.id });
    return openChapter(chapter.id);
  }

  /** 按历史记录导航到某一层 */
  async function navigateEntry(entry) {
    if (!entry) return false;
    if (entry.site) return restoreSitePage(entry.route);
    if (INNER_KEYS.has(entry.moduleId)) {
      if (bookDomGone()) return reenterFromSite({ path: entry.route });
      await showPath(entry.route, { flip: false });
      return true;
    }
    const chapter = chapterById(entry.moduleId);
    if (!chapter) return false;
    const param =
      chapter.id === 'cuisines' || chapter.id === 'tastes' ? String(entry.route).split('/')[2] : undefined;
    if (bookDomGone()) return reenterFromSite({ id: chapter.id, param, path: entry.route });
    return openChapter(chapter.id, param);
  }

  /**
   * 返回：上一页 / 上一模块。
   * 详情页先回它的上一级；没有历史就回目录 —— 任何情况下都不合书。
   */
  async function goBackOne(source = 'button') {
    if (mode !== 'open') return false;
    if (busy) {
      if (backRetry < 24) {
        backRetry += 1;
        window.setTimeout(() => void goBackOne('retry'), 120);
      }
      return false;
    }
    backRetry = 0;
    if (currentKey === 'admin') return void leaveAdmin(), true;
    if (shell.el.classList.contains('is-atlas-expanded')) {
      closeAllOverlays();
      return true;
    }
    const state = historyState();
    const prev = state.index > 0 ? state.entries[state.index - 1] : null;

    // 详情页：先回它的上一级模块（图鉴），不合书。
    // 「上一级」是一次退货：占住详情当前这一格，不新增条目（否则返回会在详情与列表间打乒乓）
    if (inner) {
      expectRevisit(state.index);
      const ok = await showPath('/dishes', { flip: false });
      if (!ok) {
        cancelRevisit();
        restoreCursor(state.index);
      }
      history.replaceState({ path: '/dishes' }, '', '/dishes');
      return true;
    }

    if (bookDomGone()) {
      if (prev && prev.site) {
        expectRevisit(state.index - 1);
        if (restoreSitePage(prev.route)) return true;
        cancelRevisit();
      }
      if (prev) {
        expectRevisit(state.index - 1);
        const ok = await reenterFromSite({ id: chapterById(prev.moduleId)?.id, path: prev.route });
        if (!ok) cancelRevisit();
        return ok;
      }
      return reenterFromSite({ id: 'catalog', path: '/' });
    }

    if (!prev) {
      // 没有历史：回目录，但书继续保持打开（占住当前这一格，反复返回不会来回打乒乓）
      expectRevisit(state.index);
      return openChapter('catalog');
    }
    expectRevisit(state.index - 1);
    const ok = await navigateEntry(prev);
    if (!ok) {
      cancelRevisit();
      restoreCursor(state.index);
    }
    return ok;
  }

  /** 合上：唯一的合书入口（站内页上先把书页挂回来再合） */
  async function shutBook(source = 'button') {
    if (mode !== 'open' || busy) return false;
    closeDishVideo('book', { instant: true });
    if (bookDomGone()) {
      parkSitePage(location.pathname + location.search);
      sheets.reattach(shell.content);
      void book.disposeInner(inner);
      inner = null;
      innerKind = null;
      const single = lastBox.mode === 'single';
      position = { single, value: single ? 2 : 0 };
      await render();
    }
    await shut();
    history.pushState({ path: '/' }, '', '/');
    return true;
  }

  /* 书签点击已在 createBookmarks 内部绑定，这里不再重复绑定 */

  /* ---------------- 合上 ---------------- */
  async function shut() {
    if (mode !== 'open' || busy) return;
    closeDishChat('book');
    closeDishVideo('book', { instant: true });
    closeAllOverlays({ instant: true });
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
  /* 合上：独立按钮，只有它执行合书动画 */
  shell.shutBtn.addEventListener('click', () => void shutBook('button'));

  /* 返回目录：和书签、目录条目走同一个 openChapter —— 一页一页翻回去，不重开书 */
  shell.catalogBtn.addEventListener('click', () => {
    if (mode !== 'open') return;
    void goBookmark({ id: 'catalog' });
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
  // 印章面板里的入口（如「管理员后台」）点击后先收起面板，再让链接照常跳转
  window.addEventListener('foodsoul:seal-panel-close', () => setPanel(false));

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
    if (bookDomGone()) {
      // 从 AI 聊天等站内页返回：书页已不在 DOM 里，整页重进更稳
      location.assign(path);
      return;
    }
    if (mode === 'closed') {
      history.pushState({ path }, '', path);
      // 后台 / 菜品详情这类内页：先把书打开，再落到内页那一叠纸
      if (INNER_KEYS.has(moduleOf(path).key)) {
        void openFirst(0);
        return;
      }
      shell.setActive(chapterOf(path));
      return;
    }
    void showPath(path);
    history.pushState({ path }, '', path);
  });

  window.addEventListener('popstate', () => {
    if (busy) return;
    const path = location.pathname + location.search;
    if (bookDomGone()) {
      // 站内页上按浏览器前进 / 后退：能接回寄存的聊天页就接回，否则重进书里
      if (parkedSite && parkedSite.route === path) {
        restoreSitePage(path);
        return;
      }
      void reenterFromSite({ id: chapterOf(path), path });
      return;
    }
    if (mode === 'closed') {
      shell.setActive(chapterOf(path));
      return;
    }
    void showPath(path, { flip: false });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (panelOpen) return setPanel(false);
      if (mode === 'open') return void shutBook('escape');
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

  /*
   * 菜谱模块的深链接：从菜品详情「生成菜谱」跳过来后再刷新（或直接打开分享链接），
   * 地址里带着 dish/name，用户期望一进来就看见表单，而不是再点一次封面。
   *
   * 只对「/recipe 且带菜品参数」破例：裸的 /recipe 仍按全站规则停在合上的书，
   * 别的页面一概不受影响。
   */
  const bootQuery = new URLSearchParams(location.search);
  if (location.pathname === '/recipe' && (bootQuery.get('dish') || bootQuery.get('name'))) {
    window.setTimeout(() => {
      if (phase === 'CLOSED_TILTED' && mode === 'closed') void openFirst();
    }, 120);
  }

  /** 首开预热：书签、返回键、翻页键平时隐藏，第一次点封面时才在 760ms 那一刻上屏 */
  function warmOpenChrome() {
    if (mode !== 'closed' || busy || phase !== 'CLOSED_TILTED') return;
    const els = [...shell.el.querySelectorAll('.bk-marks, .bk-back, .bk-catalog-btn')];
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
    /* 后台：进入前的位置与退出 */
    exitAdmin: leaveAdmin,
    get adminReturn() {
      return adminReturn;
    },
    get innerKind() {
      return innerKind;
    },
    turn,
    inspect: () => sheets.inspect(),
    /* 目录页：当前高亮的章节（验收用） */
    setChapterActive: (id) => book.setChapterActive?.(id),
    catalogItems: () => [...document.querySelectorAll('.catalog__item')].map((i) => ({ id: i.dataset.chapter, on: i.classList.contains('is-on') })),
    /* 书签当前绑在哪张纸、在哪一侧（诊断 / 验收用） */
    marks: () => (marksApi ? marksApi.state() : []),
    /* 「生成菜谱」统一导航（验收 / 诊断用；全站入口走 recipe-nav.navigateToRecipeModule） */
    recipeNav: goRecipeModule,
    recipePayload: () => peekRecipeNav(),
    /* 统一导航：历史栈 / 返回 / 合上（验收与诊断用） */
    history: historyState,
    busy: () => busy,
    currentModule: () => currentEntry(),
    back: () => goBackOne('api'),
    shutBook: () => shutBook('api'),
    /* 双页聊天（验收 / 诊断用） */
    chat: dishChatState,
    chatOpen: () => hasOpenDishChat(),
    chatDish: () => openDishChatDishId(),
    closeChat: () => closeDishChat('api'),
    openChat: (subject) =>
      openDualChat(subject, document.querySelector('.atlas-detail') || document.querySelector('.catb__ai') || null),
    video: dishVideoState,
    videoOpen: () => hasOpenDishVideo(),
    videoDish: () => openDishVideoDishId(),
    closeVideo: () => closeDishVideo('api'),
    openVideo: (dish) =>
      openDualVideo(dish, document.querySelector('.atlas-detail') || document.querySelector('.catb__ai') || null),
    parkedRoute: () => parkedSite?.route ?? null,
    goModule: (id) => goBookmark({ id }),
    syncMarks,
    shell,
  };

  /* 全站「生成菜谱」入口 → 画册翻页 → 菜谱模块回填 */
  setRecipeNavigator(goRecipeModule);
  /* 详情页「和某某聊聊」→ 画册把聊天开在另一半页 */
  setDishChatOpener((subject, originEl) => {
    void openDualChat(subject, originEl);
    return true;
  });
  /* 详情页「做菜视频」→ 画册把视频开在另一半页 */
  setDishVideoOpener((dish, originEl) => {
    void openDualVideo(dish, originEl);
    return true;
  });

  return {
    shell,
    destroy() {
      stopObserve();
    },
  };
}