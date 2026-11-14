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

/**
 * 手机横屏判定：不看 UA，只看「短边是手机高度、横向放置」这一组几何事实。
 * 平板横屏（如 1180×820、1024×768）高度远大于 540，不会进入这套尺寸；
 * 窄窗口电脑即使宽度接近手机，也因高度/可用宽度不满足而保持桌面布局。
 */
export function isPhoneLandscape(vw, vh) {
  // 只在触屏设备上启用横屏画册：同尺寸的桌面窄窗口仍走原来的桌面/单页逻辑。
  const touch =
    typeof navigator !== 'undefined' &&
    ((navigator.maxTouchPoints || 0) > 0 ||
      window.matchMedia?.('(pointer: coarse)').matches);
  return Boolean(touch) && vw > vh && vh <= 540 && vw <= 1100 && vw >= 540;
}

function safeInset(side) {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(`--safe-${side}`));
  return Number.isFinite(v) ? v : 0;
}

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
  const phoneLandscape = isPhoneLandscape(vw, vh);

  /*
   * 手机横屏：直接按可用宽高分配，不再套桌面「宽高比夹取」。
   * 原因：844×390 的 4:3 双页若仍要求 h/w ≥ 0.52，书宽最多 704px，
   * 只能到 83%，永远达不到 94%–98%。这里刻意让书更宽、页面更接近正方形。
   *
   * 书签仍从书口外侧露出，但允许压住书缘 22px（只压纸边，不压内边距），
   * 这样纸张可以接近满宽，书签也不会被屏幕裁掉。
   */
  if (phoneLandscape) {
    const sl = safeInset('left');
    const sr = safeInset('right');
    const st = safeInset('top');
    const sb = safeInset('bottom');
    const availW = Math.max(320, vw - sl - sr);
    const availH = Math.max(220, vh - st - sb);
    const w = Math.max(300, Math.round(availW * 0.952));
    const h = Math.max(220, Math.round(availH * 0.94));
    return {
      mode: 'spread',
      mobileLandscape: true,
      vw,
      vh,
      w,
      h,
      ratio: +(h / w).toFixed(3),
      bookShift: Math.round(-12 + (sl - sr) / 2),
      markOverlap: 22,
    };
  }

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

  return {
    mode,
    mobileLandscape: false,
    vw,
    vh,
    w,
    h,
    ratio: +(h / w).toFixed(3),
    bookShift: 0,
    markOverlap: 4,
  };
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
