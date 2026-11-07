/**
 * BookLayoutController
 * 只负责「画册多大、放哪、单页还是双页」，不碰任何动画。
 *
 * 规则：
 *   1. 以可视区域（visualViewport 优先）为基准，四周留一圈均匀细边
 *   2. 宽高都尽量占满，但把页面的高宽比限制在合理区间，避免被拉成怪形状
 *   3. 双页 / 单页按宽度断点切换，断点与 CSS 的 860px 保持一致
 */
export const BREAKPOINT = 860;

/** 页宽:页高 的允许区间（双页按整本算） */
const RATIO = {
  spread: { min: 0.52, max: 0.72 },
  single: { min: 1.05, max: 1.8 },
};

/** 右侧书口要留出书签露出的位置（书签不压内容、不出屏） */
const TAB_ROOM = { spread: 48, single: 34 };

/** 四周留白：按视口比例给，最少 8px；右侧再留出书签露出的宽度 */
function padding(vw, vh, mode = 'spread') {
  return {
    x: Math.max(8, Math.round(vw * 0.02)) + TAB_ROOM[mode],
    y: Math.max(8, Math.round(vh * 0.03)),
  };
}

export function measure() {
  const vv = window.visualViewport;
  return {
    vw: Math.round(vv?.width || window.innerWidth || document.documentElement.clientWidth),
    vh: Math.round(vv?.height || window.innerHeight || document.documentElement.clientHeight),
  };
}

/**
 * @returns {{mode:'spread'|'single', vw:number, vh:number, w:number, h:number, ratio:number}}
 */
export function computeLayout() {
  const { vw, vh } = measure();
  // 手机竖屏 / 窄屏走单页；横屏但够宽（≥720）仍用双页，避免书被压成一条
  const portraitNarrow = vw < BREAKPOINT && vw <= vh;
  const mode = vw >= BREAKPOINT || (!portraitNarrow && vw >= 720) ? 'spread' : 'single';
  const pad = padding(vw, vh, mode);

  let w = Math.max(200, vw - pad.x * 2);
  let h = Math.max(160, vh - pad.y * 2);

  const band = RATIO[mode];
  const r = h / w;
  if (r > band.max) h = Math.round(w * band.max);
  else if (r < band.min) w = Math.round(h / band.min);

  return { mode, vw, vh, w, h, ratio: +(h / w).toFixed(3) };
}

/**
 * 监听尺寸变化：窗口缩放、最大化、全屏、旋转、移动端地址栏收放都覆盖。
 * @param {() => void} cb
 * @returns {() => void} 取消监听
 */
export function observeLayout(cb) {
  let raf = 0;
  const schedule = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(cb);
  };

  const ro = new ResizeObserver(schedule);
  ro.observe(document.documentElement);

  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
    window.visualViewport?.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('scroll', schedule);
  };
}
