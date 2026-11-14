/**
 * 手机竖屏横屏引导
 * ------------------------------------------------------------
 * 只对「触屏 + 手机级屏幕短边 + 手机级视口」生效：
 *   - 不用 UA 作为唯一判据，避免把窄窗口电脑误判成手机；
 *   - 平板（短边 ≥ 600）不强制出现；
 *   - 竖屏显示、横屏自动收起；再次转回竖屏显示轻量版提示。
 *
 * 强制旋转只在用户点按钮后尝试，失败静默回退为手动旋转。
 */
import './orientation-guide.css';

const TITLE_FIRST = '横屏体验，开启完整食有灵';
const DESC_FIRST = '为了呈现完整的中国美食画册，请将手机旋转至横屏模式。';
const TITLE_BACK = '请旋转回横屏';
const DESC_BACK = '画册需要横屏显示，旋转手机即可继续阅读。';

function detectPhone() {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const touch = (navigator.maxTouchPoints || 0) > 0;
  const sw = Math.min(window.screen?.width || 0, window.screen?.height || 0);
  const sh = Math.max(window.screen?.width || 0, window.screen?.height || 0);
  const vw = window.visualViewport?.width || window.innerWidth;
  const vh = window.visualViewport?.height || window.innerHeight;
  const shortViewport = Math.min(vw, vh);
  // 手机级短边：常见手机 320–480；折叠屏/大屏手机放宽到 600。
  // 平板短边通常 768+，不会命中。
  const phoneScreen = sw > 0 && sw <= 600 && sh <= 1200;
  const phoneViewport = shortViewport <= 600 && Math.max(vw, vh) <= 1100;
  return (coarse || touch) && phoneScreen && phoneViewport;
}

function isPortrait() {
  const vw = window.visualViewport?.width || window.innerWidth;
  const vh = window.visualViewport?.height || window.innerHeight;
  return vh > vw;
}

export function initOrientationGuide({ onEnter } = {}) {
  let el = null;
  let button = null;
  let titleEl = null;
  let descEl = null;
  let statusEl = null;
  let entered = false;
  let visible = false;
  let timer = 0;
  let disposed = false;

  const build = () => {
    el = document.createElement('div');
    el.className = 'orientation-guide';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'orientation-guide-title');
    el.hidden = true;
    el.innerHTML = `
      <div class="orientation-guide__backdrop" aria-hidden="true"></div>
      <div class="orientation-guide__panel">
        <p class="orientation-guide__kicker">FOOD SOUL · 食有灵</p>
        <div class="orientation-guide__phone" aria-hidden="true">
          <span class="orientation-guide__phone-screen"></span>
          <span class="orientation-guide__phone-home"></span>
          <span class="orientation-guide__arc"></span>
        </div>
        <h2 class="orientation-guide__title" id="orientation-guide-title">${TITLE_FIRST}</h2>
        <p class="orientation-guide__desc">${DESC_FIRST}</p>
        <p class="orientation-guide__status" aria-live="polite"></p>
        <button class="orientation-guide__btn" type="button">进入横屏体验</button>
        <p class="orientation-guide__foot">横屏后可用书签与页脚翻页 · 竖屏会再次提示</p>
      </div>`;
    document.body.append(el);
    button = el.querySelector('.orientation-guide__btn');
    titleEl = el.querySelector('.orientation-guide__title');
    descEl = el.querySelector('.orientation-guide__desc');
    statusEl = el.querySelector('.orientation-guide__status');
    button.addEventListener('click', onButton);
  };

  const setTexts = (back) => {
    titleEl.textContent = back ? TITLE_BACK : TITLE_FIRST;
    descEl.textContent = back ? DESC_BACK : DESC_FIRST;
    button.textContent = back ? '继续横屏体验' : '进入横屏体验';
    el.classList.toggle('is-returning', back);
  };

  const show = () => {
    if (!el || visible || disposed) return;
    visible = true;
    el.hidden = false;
    // 下一帧再加 is-on，确保过渡生效
    requestAnimationFrame(() => {
      if (visible) el.classList.add('is-on');
    });
    const back = entered;
    setTexts(back);
    statusEl.textContent = '';
    button.disabled = false;
    el.classList.remove('is-waiting');
    try {
      button.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
  };

  const hide = () => {
    if (!el || !visible) return;
    visible = false;
    el.classList.remove('is-on', 'is-waiting');
    window.setTimeout(() => {
      if (!visible && el) el.hidden = true;
    }, 280);
  };

  const closeForLandscape = () => {
    if (!visible) return;
    hide();
    entered = true;
    onEnter?.();
  };

  function onButton() {
    if (!el || !visible) return;
    entered = true;
    el.classList.add('is-waiting');
    button.disabled = true;
    statusEl.textContent = '已进入横屏等待，请旋转手机…';
    // 仅在用户主动点击后尝试；任何不支持/拒绝都静默回退
    try {
      const result = window.screen?.orientation?.lock?.('landscape');
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {
      /* 浏览器不允许强制旋转：继续等用户手动旋转 */
    }
    if (!isPortrait()) closeForLandscape();
  }

  const sync = () => {
    if (disposed) return;
    const phone = detectPhone();
    if (!phone) {
      if (visible) hide();
      return;
    }
    if (isPortrait()) {
      show();
    } else {
      closeForLandscape();
    }
  };

  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(sync, 120);
  };

  build();
  // 首帧先不显示，等布局稳定后再判断，避免地址栏/首屏尺寸抖动
  requestAnimationFrame(() => requestAnimationFrame(sync));

  const onOrientation = () => schedule();
  window.addEventListener('resize', onOrientation, { passive: true });
  window.addEventListener('orientationchange', onOrientation, { passive: true });
  window.visualViewport?.addEventListener('resize', onOrientation, { passive: true });
  window.screen?.orientation?.addEventListener?.('change', onOrientation);
  window.matchMedia?.('(orientation: portrait)')?.addEventListener?.('change', onOrientation);

  return {
    sync,
    destroy() {
      disposed = true;
      window.clearTimeout(timer);
      window.removeEventListener('resize', onOrientation);
      window.removeEventListener('orientationchange', onOrientation);
      window.visualViewport?.removeEventListener('resize', onOrientation);
      window.screen?.orientation?.removeEventListener?.('change', onOrientation);
      window.matchMedia?.('(orientation: portrait)')?.removeEventListener?.('change', onOrientation);
      el?.remove();
      el = null;
    },
    get visible() {
      return visible;
    },
  };
}