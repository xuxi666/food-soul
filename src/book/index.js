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
import { mountAccount } from '../components/account.js';
import './book.css';
import './atlas.css';
import './category.css';

const FLIP_MS = 660;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

export function initBook({ root }) {
  document.body.classList.add('is-book');
  const shell = createShell(root);

  /* ---------------- 尺寸 ---------------- */
  function fit() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const narrow = vw <= 860;

    let w;
    let hgt;
    if (narrow) {
      w = Math.min(vw * 0.94, 620);
      hgt = Math.min(vh * 0.78, w * 1.34);
    } else {
      w = Math.min(vw * 0.86, 1240);
      hgt = Math.min(vh * 0.8, w * 0.66);
    }
    shell.el.style.setProperty('--book-w', `${Math.round(w)}px`);
    shell.el.style.setProperty('--book-h', `${Math.round(hgt)}px`);
  }
  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', fit);

  /* ---------------- 相机 ---------------- */
  function camera(scale, y = 0) {
    shell.el.style.setProperty('--cam-scale', String(scale));
    shell.el.style.setProperty('--cam-y', `${y}px`);
  }
  camera(0.88, 14);

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
    if (mode !== 'closed' || busy) return;
    busy = true;
    try {
      shell.book.classList.add('bk-book--open');
      shell.book.classList.remove('bk-book--closed');
      shell.el.classList.add('is-open');
      camera(1, 0);
      await wait(760);
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
        const label = chapter ? chapter.label : '';
        shell.setFolio(`${label} · 索引`, `${label} · 代表菜`);
      };
      if (flip && currentKey && currentKey !== info.key) await flipLeaf('next', apply);
      else apply();
      currentKey = info.key;
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
        shell.setFolio('图鉴 · 左页', '图鉴 · 右页');
      };
      if (needFlip) await flipLeaf('next', apply);
      else apply();
      currentKey = 'dishes';
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
      const label = chapter ? chapter.label : info.key === 'dishDetail' ? '菜品详情' : '后台';
      shell.setFolio(label, label);
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
    updatePager();
  }

  function detachAll() {
    if (atlas?.el.parentNode) atlas.el.remove();
    if (catChapter?.el.parentNode) catChapter.el.remove();
    for (const [, entry] of hosts) if (entry.el.parentNode) entry.el.remove();
  }

  /* ---------------- 翻页按钮 ---------------- */
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
      // 翻完镜头轻推一下，落在清晰的双页上
      camera(1.035, -3);
      await wait(160);
      camera(1, 0);
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
      shell.book.classList.remove('bk-book--open');
      shell.book.classList.add('bk-book--closed');
      shell.el.classList.remove('is-open');
      camera(0.88, 14);
      await wait(720);
      mode = 'closed';
    } finally {
      busy = false;
    }
  }
  shell.backBtn.addEventListener('click', () => void shut());

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
  shell.book.classList.add('bk-book--closed');

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

  return { shell };
}
