/**
 * 流体穿梭式转场（FOOD SOUL 专属转场语言）
 * ------------------------------------------------------------------
 * 概念：首页与目标页面处在同一个连续空间里，旧页面柔和退向空间深处，
 * 新页面从轻微的反向偏移处顺滑显现，配合一次极轻的暖金光影掠过。
 *
 * 结构：
 *   .shuttle                 固定全屏、低于导航层（z 55），只负责视觉
 *     .shuttle__glow         暖金光影层（低透明度、横向轻移）
 *     .shuttle__in           目标页面容器（真实挂载，整体做位移/缩放/透明度）
 *       .shuttle__tint       与站点一致的深色底 + 主题色顶部微光
 *       .shuttle__stage      真实的页面 DOM（由 router.mountInto 渲染）
 *       .shuttle__pending    数据仍在加载时的细金色进度条
 *
 * 只使用 transform / opacity；不使用圆形裁剪、不使用整页 blur。
 * 目标页面在动画开始时就开始真实挂载（这是硬性要求），动画结束后由
 * router.adopt 把预览层里的真实节点接管进 #view。
 */

const reduced = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** 各阶段时长与幅度（ms / px），整体 380ms 左右由并行动画完成 */
export const SHUTTLE_PARAMS = {
  forward: { total: 420, out: 260, in: 330, delay: 90, offsetX: 18, offsetY: 8, scale: 0.985, glow: 0.16 },
  back: { total: 240, out: 220, in: 230, delay: 10, offsetX: 9, offsetY: 5, scale: 0.992, glow: 0.09 },
};

/** 入口方向：nav 纵向、card 景深、chat 纵向、auto 轻微横向 */
const DIRECTIONS = {
  nav: { x: 0, y: 1 },
  card: { x: 0, y: 1 },
  chat: { x: 0.2, y: 1 },
  auto: { x: 1, y: 0.35 },
  back: { x: 0, y: 1 },
};

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

let busy = false;
let cleanup = null;
let watchdogs = new Set();

function clearWatchdogs() {
  watchdogs.forEach((id) => window.clearTimeout(id));
  watchdogs.clear();
}

export function isTransitioning() {
  return busy;
}

/** 阶段 1：点击目标极轻微的亮度反馈（不弹跳、不位移） */
export function tapPulse(el) {
  if (!el || reduced()) return;
  el.classList.add('is-tap');
  window.setTimeout(() => el.classList.remove('is-tap'), 150);
}

/**
 * 执行一次流体穿梭转场。
 * @param {object} opts
 * @param {(stage:HTMLElement)=>Promise<any>} opts.render 把目标页面真实挂载进 stage
 * @param {(stage:HTMLElement, instance:any)=>void} opts.commit 动画结束时接管 DOM 与路由
 * @param {'auto'|'nav'|'card'|'chat'|'back'} [opts.kind] 入口类型，决定位移方向
 * @param {string} [opts.accent] 目标页面主题色（用于顶部微光）
 * @param {HTMLElement|null} [opts.el] 触发转场的元素（用于轻微亮度反馈）
 * @returns {Promise<boolean>} 是否真正执行了转场
 */
export async function fluidTransition({ render, commit, kind = 'auto', accent = '#d8b26a', el = null }) {
  if (busy) return false;

  // 阶段 1：点击目标极轻微的亮度反馈
  tapPulse(el);

  // 尊重系统「减少动态效果」：直接导航，不播放动画
  if (reduced()) {
    const holder = document.createElement('div');
    const instance = await render(holder);
    commit(holder, instance);
    return false;
  }

  busy = true;
  document.body.classList.add('is-transitioning');
  const params = kind === 'back' ? SHUTTLE_PARAMS.back : SHUTTLE_PARAMS.forward;
  const dir = DIRECTIONS[kind] || DIRECTIONS.auto;
  const isCard = kind === 'card';

  const inX = isCard ? 0 : dir.x * params.offsetX;
  const inY = isCard ? -8 : dir.y * params.offsetY;
  const outX = isCard ? 0 : -inX * 0.8;
  const outY = isCard ? 9 : -inY * 0.6;
  const inScale = isCard ? 0.972 : params.scale;

  const shell = document.createElement('div');
  shell.className = `shuttle shuttle--${kind}`;
  shell.setAttribute('aria-hidden', 'true');

  const glow = document.createElement('div');
  glow.className = 'shuttle__glow';

  const incoming = document.createElement('div');
  incoming.className = 'shuttle__in';

  const tint = document.createElement('div');
  tint.className = 'shuttle__tint';
  tint.style.setProperty('--shuttle-accent', accent);

  const stage = document.createElement('div');
  stage.className = 'shuttle__stage';

  const pending = document.createElement('div');
  pending.className = 'shuttle__pending';

  incoming.append(tint, stage, pending);
  shell.append(glow, incoming);
  document.body.append(shell);

  const viewEl = document.getElementById('view');

  // 阶段 2：旧页面柔和退向空间后方（位移 12–20px、缩放 1.5%）
  const outMove = viewEl?.animate(
    [
      { offset: 0, transform: 'translate3d(0, 0, 0) scale(1)' },
      {
        offset: 0.52,
        transform: `translate3d(${outX * 0.6}px, ${outY * 0.6}px, 0) scale(${(1 + params.scale) / 2})`,
      },
      {
        offset: 1,
        transform: `translate3d(${outX}px, ${outY}px, 0) scale(${params.scale})`,
      },
    ],
    { duration: params.out, easing: EASE, fill: 'forwards' }
  );

  // 透明度单独一条曲线：前段保持稳定，后段平滑淡出（避免瞬间消失）
  const outFade = viewEl?.animate(
    [
      { offset: 0, opacity: 1 },
      { offset: 0.42, opacity: 0.88 },
      { offset: 0.76, opacity: 0.46 },
      { offset: 1, opacity: 0 },
    ],
    { duration: params.out, easing: 'linear', fill: 'forwards' }
  );

  // 阶段 3：新页面从反向偏移处显现（与离场重叠约 150ms）
  const inMove = incoming.animate(
    [
      { offset: 0, transform: `translate3d(${inX}px, ${inY}px, 0) scale(${inScale})` },
      { offset: 0.55, transform: `translate3d(${inX * 0.28}px, ${inY * 0.28}px, 0) scale(${(1 + inScale) / 2 + 0.003})` },
      { offset: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
    ],
    { duration: params.in, delay: params.delay, easing: EASE, fill: 'both' }
  );

  const inFade = incoming.animate(
    [
      { offset: 0, opacity: 0 },
      { offset: 0.5, opacity: 0.62 },
      { offset: 1, opacity: 1 },
    ],
    { duration: params.in, delay: params.delay, easing: 'linear', fill: 'both' }
  );

  // 一次非常轻柔的暖金光影掠过
  const glowAnim = glow.animate(
    [
      { offset: 0, transform: 'translate3d(-14%, 0, 0) scale(1.02)', opacity: 0 },
      { offset: 0.45, opacity: params.glow },
      { offset: 1, transform: 'translate3d(14%, 0, 0) scale(1.02)', opacity: 0 },
    ],
    { duration: params.total, easing: 'cubic-bezier(0.33, 0, 0.2, 1)', fill: 'both' }
  );

  const anims = [outMove, outFade, inMove, inFade, glowAnim].filter(Boolean);
  let finished = false;
  let instance = null;
  let renderError = null;

  // 目标页面立刻开始真实挂载（数据/加载状态在动画中可见，不做假图）
  const renderPromise = Promise.resolve()
    .then(() => render(stage))
    .then((inst) => {
      instance = inst;
      return inst;
    })
    .catch((err) => {
      renderError = err;
      console.warn('[transition] render failed', err);
      return null;
    });

  const teardown = (adopt) => {
    if (finished) return;
    finished = true;
    clearWatchdogs();
    busy = false;
    cleanup = null;
    document.body.classList.remove('is-transitioning');
    if (adopt) {
      try {
        commit(stage, instance);
      } catch (err) {
        console.warn('[transition] commit failed', err);
      }
    }
    // 先让新内容落进 #view 且完成一次绘制，再撤掉遮挡层，避免闪白/闪黑
    anims.forEach((a) => {
      try {
        a.cancel();
      } catch {
        /* noop */
      }
    });
    if (viewEl) {
      viewEl.style.transform = '';
      viewEl.style.opacity = '';
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        shell.remove();
      });
    });
  };

  cleanup = () => teardown(false);

  // 兜底：数据迟迟不来时，最多 12s 后强制接管（避免遮罩卡死）
  const guard = window.setTimeout(() => {
    console.warn('[transition] watchdog force commit');
    teardown(true);
  }, 12000);
  watchdogs.add(guard);

  try {
    // 动画跑到一半时若数据还没回来，显示细金色进度提示（真实加载状态）
    await Promise.all([
      inMove.finished.catch(() => {}),
      inFade.finished.catch(() => {}),
      Promise.race([renderPromise, delay(520)]),
    ]);
    if (!instance && !renderError) pending.classList.add('is-on');

    await Promise.all([...anims.map((a) => a.finished.catch(() => {})), renderPromise]);
    window.clearTimeout(guard);
    watchdogs.delete(guard);
    if (renderError) {
      teardown(false);
      return false;
    }
    teardown(true);
    return true;
  } catch (err) {
    console.warn('[transition]', err);
    teardown(false);
    return false;
  }
}

/** 转场中用户又点击了别的入口：立刻清理，避免遮罩/位移残留 */
export function abortTransition() {
  cleanup?.();
  cleanup = null;
  clearWatchdogs();
  document.querySelectorAll('.shuttle').forEach((el) => el.remove());
  document.querySelectorAll('.reveal').forEach((el) => el.remove());
  const viewEl = document.getElementById('view');
  if (viewEl) {
    viewEl.style.transform = '';
    viewEl.style.opacity = '';
  }
  document.body.classList.remove('is-transitioning');
  busy = false;
}
