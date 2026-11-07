/**
 * 首页背景：动态环形美食图片墙
 * -------------------------------------------------------------
 * 画册背后铺满多行真实菜品照片，奇数行向右、偶数行向左，各自匀速循环。
 *
 * 无缝循环的做法：每行由两段完全相同的内容（.bk-wall__set）首尾相接组成一条轨道，
 * 轨道宽度 = 2 × 单段宽度（单段自带尾部间距），动画只做 translate3d(-50%) ↔ 0，
 * 也就是永远刚好移动一段的距离。所以：
 *   - 循环交界处不会出现空白，也不会「跳回起点」；
 *   - 窗口尺寸变化不需要重算像素距离（百分比本身就是精确的一段）。
 *
 * 图片用 public/wall/*.webp（scripts/gen-wall-thumbs.py 从图鉴原图生成，平均 12KB），
 * 不直接上原图：几十张 100KB 的 jpg 会把首屏拖到十几 MB。
 * 每张图只出现在一处（洗牌后不重复发牌），第二段复用同一批 URL，浏览器只请求一次。
 */
import { h } from '../lib/dom.js';
import { DISHES } from '../data/dishes.js';

const THUMB_DIR = '/wall/';
const ASPECT = 1.5; // 3:2 横图
const GAP = 6; // 卡片水平间距（px）：密排，只留一道细缝
const ROW_GAP = 6; // 行间距（px）
/** 每行的完整循环周期（秒）：全部不同，避免两行同拍 */
const ROW_DURATIONS = [34, 44, 39, 52, 30, 47, 41];

/** 图片池：图鉴里真实菜品，去重后按 id 排序，保证每次洗牌结果稳定 */
const POOL = (() => {
  const seen = new Set();
  const list = [];
  for (const d of DISHES) {
    if (!d.image || seen.has(d.image)) continue;
    seen.add(d.image);
    const base = d.image.split('/').pop().replace(/\.[a-z0-9]+$/i, '');
    list.push({ id: d.id, name: d.name, thumb: THUMB_DIR + base + '.webp', full: d.image });
  }
  return list.sort((a, b) => (a.id < b.id ? -1 : 1));
})();

/** 固定种子的洗牌：刷新页面排布不变，避免每次进站都是新面孔 */
function seededShuffle(list, seed = 20261007) {
  const out = list.slice();
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 行数：屏幕越高行越多；手机只留 3～4 行，平板 4～6 行 */
function rowsFor(w, h) {
  // 行数按「目标卡片高度」倒推：桌面 ~132px 一行（铺满 7~9 行），平板 ~170，手机 ~210
  if (w < 640) return Math.max(3, Math.min(5, Math.round(h / 210)));
  if (w < 1100) return Math.max(4, Math.min(6, Math.round(h / 170)));
  return Math.max(6, Math.min(9, Math.round(h / 132)));
}

function idle(fn) {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(fn, { timeout: 1200 });
  } else {
    window.setTimeout(fn, 240);
  }
}

export function createFoodWall() {
  const el = h('div', { class: 'bk-wall', 'aria-hidden': 'true' });
  let built = { w: 0, h: 0, rows: 0 };
  let pool = [];
  let cursor = 0;
  let io = null;

  /** 取下一批不重复的图片，用完再从头来（池子够大时不会重复） */
  function take(n) {
    if (!pool.length) pool = seededShuffle(POOL);
    const picked = [];
    for (let i = 0; i < n; i += 1) {
      picked.push(pool[cursor % pool.length]);
      cursor += 1;
    }
    return picked;
  }

  function card(item, { defer = false } = {}) {
    const img = h('img', {
      class: 'bk-wall__img',
      alt: '',
      // 第一段（此刻就能看见的那半条轨道）立刻取；第二段等首屏画完再取
      loading: defer ? 'lazy' : 'eager',
      decoding: 'async',
      draggable: 'false',
    });
    img.width = 400;
    img.height = 267;

    // 缩略图缺失 / 坏图：退回原图，再不行换一张池子里的，不让墙上出现破图
    let stage = 0;
    img.addEventListener('error', () => {
      if (stage === 0) {
        stage = 1;
        img.src = item.full;
        return;
      }
      if (stage === 1) {
        stage = 2;
        const alt = POOL[(cursor + 7) % POOL.length];
        img.src = alt ? alt.full : '';
        return;
      }
      img.classList.add('is-dead');
    });

    if (defer) {
      img.dataset.src = item.thumb;
      img.alt = '';
    } else {
      img.src = item.thumb;
      img.alt = item.name || '';
    }
    return h('div', { class: 'bk-wall__card' }, img);
  }

  function build() {
    const vw = Math.max(320, window.innerWidth);
    const vh = Math.max(420, window.innerHeight);
    const rows = rowsFor(vw, vh);
    const rowH = vh / rows;
    // 窄屏别让一张照片糊满整行：按屏宽收一档，手机上仍能看到 1.5 张以上
    const tileCap = vw < 640 ? (vw * 0.58) / ASPECT : rowH;
    const tileH = Math.max(72, Math.round(Math.min(rowH - ROW_GAP, tileCap)));
    const tileW = Math.round(tileH * ASPECT);
    const perRow = Math.max(3, Math.ceil(vw / (tileW + GAP)) + 1);

    built = { w: vw, h: vh, rows };
    cursor = 0;
    el.textContent = '';
    el.style.setProperty('--wall-h', `${vh}px`);
    el.style.setProperty('--tile-h', `${tileH}px`);

    const deferred = [];
    for (let r = 0; r < rows; r += 1) {
      const set = take(perRow);
      const copies = [false, true].map((isSecond) => {
        const node = h('div', { class: 'bk-wall__set' });
        for (const item of set) {
          const c = card(item, { defer: isSecond });
          if (isSecond) deferred.push(c.querySelector('img'));
          node.append(c);
        }
        return node;
      });

      // 奇数行向右、偶数行向左；每行周期都不一样（30~52s），相邻行既不同向也不同速
      const dur = ROW_DURATIONS[r % ROW_DURATIONS.length];
      const dir = r % 2 === 0 ? 'right' : 'left';
      const track = h(
        'div',
        {
          class: `bk-wall__track bk-wall__track--${dir}`,
          style: `--dur:${dur}s;--delay:-${(r * 5.7).toFixed(1)}s;--gap:${GAP}px;`,
        },
        ...copies
      );
      const row = h('div', { class: 'bk-wall__row', style: `top:${(r * rowH).toFixed(1)}px;height:${rowH.toFixed(1)}px;` }, track);
      el.append(row);
    }

    // 第二段先不进网络队列：第一屏看不到它，等空下来再补，循环处自然接上
    idle(() => {
      for (const img of deferred) {
        if (!img.isConnected || !img.dataset.src) continue;
        // 空闲时立刻取，别等懒加载：第二段滑进视野时必须是已经画好的图
        img.loading = 'eager';
        img.src = img.dataset.src;
      }
    });
  }

  function refresh(force = false) {
    const w = Math.max(320, window.innerWidth);
    const h = Math.max(420, window.innerHeight);
    const rows = rowsFor(w, h);
    // 只有尺寸变化到会影响行数 / 卡片高度时才重建，避免频繁重建 DOM
    if (!force && rows === built.rows && Math.abs(h - built.h) < 24 && Math.abs(w - built.w) < 24) return;
    build();
  }

  let timer = 0;
  const onResize = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => refresh(), 220);
  };
  const onVisibility = () => el.classList.toggle('is-paused', document.hidden);

  build();
  window.addEventListener('resize', onResize, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);

  return {
    el,
    refresh,
    destroy() {
      window.clearTimeout(timer);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      io?.disconnect();
      el.remove();
    },
  };
}