/**
 * 画册编排
 * ------------------------------------------------------------
 * closed：合上的书，只见封面
 * open  ：展开的双页，模块真实挂在书页内容层里
 *
 * 章节切换 = 翻页 + 换内容 + 镜头推进
 * 模块只挂载一次（keep-alive），切走只脱离 DOM，状态不丢
 */
import { h, clear } from '../lib/dom.js';
import { CHAPTERS, EXTRA, chapterOf, chapterById, chapterIndex, moduleOf } from './chapters.js';
import { createShell } from './shell.js';
import { createAtlas } from './atlas.js';
import { mountCategory } from './category.js';
import { mountVideos } from './videos.js';
import { computeLayout, observeLayout, BREAKPOINT } from './layout.js';
import { mountAccount } from '../components/account.js';
import './book.css';
import './atlas.css';
import './category.css';
import './videos.css';

const FLIP_MS = 660;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

export function initBook({ root }) {
  document.body.classList.add('is-book');
  const shell = createShell(root);
  let lastBox = null;

  /* ---------------- 环境阴影（独立层） ---------------- */
  // 阴影不是书本的子节点，所以不继承 15° 旋转。
  // 每帧读取「可见物体」的屏幕包围盒（合上=封面，展开=双页），
  // 把它作为阴影层的 left/top/width/height —— 只跟随位置与尺寸，方向永远水平。
  let shadowRaf = 0;
  function fitShadow() {
    const sh = shell.shadow;
    if (!sh) return;
    const open = shell.book.classList.contains('bk-book--open') || shell.book.classList.contains('bk-book--reading');
    const target = open ? shell.spread : shell.cover;
    const cam = shell.camera.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    if (!r.width || !r.height) return;
    sh.style.left = `${r.left - cam.left}px`;
    sh.style.top = `${r.top - cam.top}px`;
    sh.style.width = `${r.width}px`;
    sh.style.height = `${r.height}px`;
  }
  /** 过渡期间逐帧贴合，过渡结束就停 */
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
    // 布局变化时把当前状态重放一次，避免书页停在旧尺寸上
    if (before && (before.mode !== lastBox.mode || before.w !== lastBox.w || before.h !== lastBox.h)) {
      shell.content.dataset.fitted = `${lastBox.w}x${lastBox.h}`;
      // 单双页切换后，图鉴每屏数量要跟着变
      if (before.mode !== lastBox.mode) atlas?.repaint();
    }
  });

  /* ---------------- 书籍状态机 ---------------- */
  // CLOSED_TILTED → STRAIGHTENING → OPENING → EXPANDING → READING
  // 返回：SHRINKING → CLOSING → CLOSED_TILTED
  let phase = 'CLOSED_TILTED';
  function setBookState(cls) {
    shell.book.className = `bk-book ${cls}`;
    // 阴影独立层：只同步状态标记，几何位置由 fitShadow 逐帧贴合
    if (shell.shadow) {
      shell.shadow.className = `bk-shadow ${cls.replace('bk-book--', 'bk-shadow--')}`;
    }
    followShadow();
    // 阅读态下书签要收进书边，翻页按钮也要落回书内
    shell.el.classList.toggle('is-reading', cls === 'bk-book--reading');
  }
  function setPhase(next) {
    phase = next;
  }

  /* ---------------- 模块 keep-alive ---------------- */
  const hosts = new Map();

  async function ensureModule(key, params) {
    if (hosts.has(key)) return hosts.get(key);
    const def = chapterById(key) || EXTRA[key];
    const mod = def ? await def.load() : null;
    if (!mod) return null;

    const el = h('div', { class: 'bk-module', 'data-key': key });
    hosts.set(key, { el, instance: null, ready: false });
    const entry = hosts.get(key);
    try {
      entry.instance = (await mod.mount(el, params || [])) || null;
    } catch (err) {
      console.warn('[book] 模块挂载失败', key, err);
      el.append(h('p', { class: 'bk-error', text: '内容加载失败，请刷新重试' }));
    }
    entry.ready = true;
    return entry;
  }

  /* ---------------- 菜系 / 口味（定制双页） ---------------- */
  let catChapter = null;
  function ensureCategory(kind, id) {
    if (!catChapter) {
      catChapter = mountCategory(shell.content, kind, id);
      catChapter.setSwitchHandler((href) => history.pushState({ path: href }, '', href));
    } else {
      catChapter.update(kind, id);
    }
    if (!catChapter.el.parentNode) shell.content.append(catChapter.el);
    return catChapter;
  }

  /* ---------------- 视频（定制双页） ---------------- */
  let videoChapter = null;
  function ensureVideos() {
    if (!videoChapter) videoChapter = mountVideos(shell.content);
    if (!videoChapter.el.parentNode) shell.content.append(videoChapter.el);
    return videoChapter;
  }

  /* ---------------- 图鉴（自带分页） ---------------- */
  let atlas = null;
  function ensureAtlas() {
    if (!atlas) atlas = createAtlas(shell.content);
    // 切走时被 detach 过，回来要重新挂上，页码与筛选状态都还在
    if (!atlas.el.parentNode) atlas.mountInto(shell.content);
    return atlas;
  }

  /* ---------------- 状态 ---------------- */
  let mode = 'closed';
  let currentKey = null;
  let busy = false;

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
      // 0) 先把页码写上：书页展开的瞬间就有页脚，不会出现空白页码
      shell.setFolio(...folioFor(location.pathname || '/dishes'));
      // 1) 回正：15° → 0°，420ms
      setPhase('STRAIGHTENING');
      setBookState('bk-book--straight');
      shell.el.classList.add('is-open');
      await wait(440);

      // 2) 封面绕书脊打开，700ms
      setPhase('OPENING');
      setBookState('bk-book--open');
      await wait(720);

      // 3) 书页本身放大到铺满视口，560ms
      setPhase('EXPANDING');
      setBookState('bk-book--reading');
      await wait(580);

      setPhase('READING');
      mode = 'open';
      await showPath(location.pathname || '/dishes', { flip: false });
    } finally {
      busy = false;
    }
  }

  /* ---------------- 翻页纸叶 ---------------- */
  async function flipLeaf(dir, swap) {
    const leaf = shell.leaf;
    leaf.classList.add('is-on');
    leaf.classList.toggle('bk-leaf--left', dir === 'prev');
    const from = dir === 'prev' ? 'rotateY(0deg)' : 'rotateY(0deg)';
    const to = dir === 'prev' ? 'rotateY(180deg)' : 'rotateY(-180deg)';
    leaf.style.transition = 'none';
    leaf.style.transform = from;
    await nextFrame();
    leaf.style.transition = `transform ${FLIP_MS}ms cubic-bezier(0.45, 0.05, 0.35, 1)`;
    leaf.style.transform = to;
    await wait(FLIP_MS * 0.46);
    swap?.();
    await wait(FLIP_MS * 0.54);
    leaf.style.transition = 'none';
    leaf.classList.remove('is-on', 'bk-leaf--left');
    leaf.style.transform = 'rotateY(0deg)';
  }

  /* ---------------- 页码文案 ---------------- */
  /** 路径 → 左右页页脚文案；打开画册时先预置，避免书页已经展开、页码还是空的 */
  function folioFor(path) {
    const info = moduleOf(path);
    const chapter = chapterById(chapterOf(path));
    const label = chapter ? chapter.label : '';
    if (info.key === 'cuisines' || info.key === 'tastes') {
      return [`${label} · 索引`, `${label} · 代表菜`];
    }
    if (info.key === 'videos') return ['视频 · 列表', '视频 · 选菜'];
    if (info.key === 'dishes') {
      const num = String((atlas ? atlas.page : 0) + 1).padStart(2, '0');
      return [`图鉴 ${num} · 左页`, `图鉴 ${num} · 右页`];
    }
    const one = label || (info.key === 'dishDetail' ? '菜品详情' : '后台');
    return [one, one];
  }

  /* ---------------- 显示某个路径 ---------------- */
  async function showPath(path, { flip = true } = {}) {
    const info = moduleOf(path);
    const chapterId = chapterOf(path);
    const chapter = chapterById(chapterId);
    shell.content.dataset.chapter = chapterId;

    // 菜系 / 口味：左页索引与介绍，右页代表菜
    if (info.key === 'cuisines' || info.key === 'tastes') {
      const kind = info.key === 'tastes' ? 'taste' : 'cuisine';
      const id = info.params[0];
      const apply = () => {
        detachAll();
        shell.content.classList.add('is-split');
        ensureCategory(kind, id);
        shell.setActive(chapterId);
        shell.setFolio(...folioFor(path));
      };
      if (flip && currentKey && currentKey !== info.key) await flipLeaf('next', apply);
      else apply();
      currentKey = info.key;
      updateBackLabel();
      updatePager();
      return;
    }

    // 视频：左页列表、右页按菜系挑
    if (info.key === 'videos') {
      const apply = () => {
        detachAll();
        shell.content.classList.add('is-split');
        ensureVideos();
        shell.setActive(chapterId);
        shell.setFolio(...folioFor(path));
      };
      if (flip && currentKey && currentKey !== info.key) await flipLeaf('next', apply);
      else apply();
      currentKey = info.key;
      updateBackLabel();
      updatePager();
      return;
    }

    // 图鉴章节走自己的分页布局
    if (info.key === 'dishes') {
      const needFlip = flip && currentKey !== 'dishes';
      const apply = () => {
        detachAll();
        shell.content.classList.add('is-split');
        ensureAtlas();
        shell.setActive('dishes');
        shell.setFolio(...folioFor(path));
      };
      if (needFlip) await flipLeaf('next', apply);
      else apply();
      currentKey = 'dishes';
      updateBackLabel();
      updatePager();
      return;
    }

    const wantSplit = chapter?.layout !== 'flow';
    shell.content.classList.toggle('is-split', wantSplit);
    const entry = await ensureModule(info.key, info.params);
    if (!entry) return;

    const apply = () => {
      detachAll();
      shell.content.append(entry.el);
      shell.setActive(chapterId);
      shell.setFolio(...folioFor(path));
      shell.content.scrollTop = 0;
    };

    if (flip && currentKey && currentKey !== info.key) {
      const from = chapterIndex(currentKey);
      const to = chapterIndex(chapterId);
      const dir = from !== -1 && to !== -1 && to < from ? 'prev' : 'next';
      await flipLeaf(dir, apply);
    } else {
      apply();
    }

    currentKey = info.key;
    updateBackLabel();
    updatePager();
  }

  function detachAll() {
    if (atlas?.el.parentNode) atlas.el.remove();
    if (catChapter?.el.parentNode) catChapter.el.remove();
    if (videoChapter?.el.parentNode) videoChapter.el.remove();
    for (const [, entry] of hosts) if (entry.el.parentNode) entry.el.remove();
  }

  /* ---------------- 翻页按钮 ---------------- */
  /** 详情页把左上角按钮切成「返回图鉴」，其余章节是「合上」 */
  function updateBackLabel() {
    const label = shell.backBtn.querySelector('.bk-back__label');
    const isDetail = currentKey === 'dishDetail';
    shell.backBtn.dataset.action = isDetail ? 'gallery' : 'close';
    shell.backBtn.setAttribute('aria-label', isDetail ? '返回图鉴' : '合上画册');
    if (label) label.textContent = isDetail ? '返回图鉴' : '合上';
  }

  function updatePager() {
    if (currentKey === 'dishes' && atlas) {
      shell.prevBtn.disabled = !atlas.hasPrev();
      shell.nextBtn.disabled = !atlas.hasNext();
      shell.setFolio(
        `图鉴 ${String(atlas.page + 1).padStart(2, '0')} · 左页`,
        `图鉴 ${String(atlas.page + 1).padStart(2, '0')} · 右页`
      );
      return;
    }
    const idx = chapterIndex(currentKey);
    shell.prevBtn.disabled = idx <= 0;
    shell.nextBtn.disabled = idx === -1 || idx >= CHAPTERS.length - 1;
  }

  async function turn(dir) {
    if (busy) return;
    busy = true;
    try {
      if (currentKey === 'dishes' && atlas) {
        const ok = dir === 'next' ? atlas.next() : atlas.prev();
        if (!ok) return;
        await flipLeaf(dir, () => atlas.repaint());
        updatePager();
        return;
      }
      const idx = chapterIndex(currentKey);
      const target = CHAPTERS[idx + (dir === 'next' ? 1 : -1)];
      if (!target) return;
      await openChapter(target.id, dir);
    } finally {
      busy = false;
    }
  }

  shell.prevBtn.addEventListener('click', () => void turn('prev'));
  shell.nextBtn.addEventListener('click', () => void turn('next'));

  /* ---------------- 章节切换 ---------------- */
  async function openChapter(id, dir) {
    if (busy) return;
    const chapter = chapterById(id);
    if (!chapter) return;
    busy = true;
    try {
      if (mode === 'closed') {
        await openFirst();
        return;
      }
      if (currentKey === id) return;
      const from = chapterIndex(currentKey);
      const to = chapterIndex(id);
      const d = dir || (from !== -1 && to < from ? 'prev' : 'next');

      // 翻页中途换内容：纸叶盖住页面的一瞬间完成切换
      let swapped = false;
      const swap = () => {
        if (swapped) return;
        swapped = true;
        void showPath(chapter.href, { flip: false });
      };
      await flipLeaf(d, swap);
      if (!swapped) await showPath(chapter.href, { flip: false });
      history.pushState({ chapter: id }, '', chapter.href);
    } finally {
      busy = false;
    }
  }

  /* ---------------- 书签 ---------------- */
  for (const ch of CHAPTERS) {
    const btn = shell.marks.get(ch.id);
    btn?.addEventListener('click', () => void openChapter(ch.id));
  }

  /* ---------------- 合上 ---------------- */
  async function shut() {
    if (mode !== 'open' || busy) return;
    busy = true;
    try {
      // 1) 书页缩回展开尺寸
      setPhase('SHRINKING');
      setBookState('bk-book--open');
      await wait(520);

      // 2) 封面合上
      setPhase('CLOSING');
      setBookState('bk-book--straight');
      shell.el.classList.remove('is-open');
      await wait(720);

      // 3) 恢复 15° 倾斜
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
    e.preventDefault();
    if (busy) return;
    const path = url.pathname + url.search;
    if (mode === 'closed') {
      void openFirst().then(() => showPath(path, { flip: false }));
      return;
    }
    void showPath(path);
    history.pushState({ path }, '', path);
  });

  window.addEventListener('popstate', () => {
    if (busy) return;
    const path = location.pathname + location.search;
    if (mode === 'closed') void openFirst().then(() => showPath(path, { flip: false }));
    else void showPath(path, { flip: false });
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

  /* ---------------- 初始：合上的书 ---------------- */
  shell.setActive(chapterOf(location.pathname));
  setBookState('bk-book--closed');

  const deepLink = location.pathname !== '/' && location.pathname !== '';
  if (deepLink) {
    window.setTimeout(() => void openFirst(), 600);
  }

  window.__book = {
    get mode() {
      return mode;
    },
    get chapter() {
      return currentKey;
    },
    open: openFirst,
    shut,
    goto: (path) => showPath(path),
    turn,
    shell,
  };

  return {
    shell,
    destroy() {
      stopObserve();
    },
  };
}
