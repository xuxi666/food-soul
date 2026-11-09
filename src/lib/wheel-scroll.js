/**
 * 书页里的滚轮滚动手感修正
 * ------------------------------------------------------------
 * 书页是 3D 变身过的纸（.bk-sheet 上的 rotateY + backface-visibility +
 * transform-style: preserve-3d），浏览器自带的「点在哪就滚哪」在这种子树里
 * 并不可靠（实测：滚轮不生效，PageDown 却可以）。所以在承载内容的滚动容器上
 * 显式把 deltaY 换算成 scrollTop：
 *   · 只有容器真的还能滚时才接管，滚到顶/到底就把事件让回去（不吞掉）；
 *   · ctrl + 滚轮是缩放，不动它；
 *   · 只滚自己这个容器，不会带动另一页，也不会带动整本书或外层页面。
 *
 * @param {HTMLElement} container 有 overflow-y:auto 的滚动容器
 * @returns {() => void} 卸载函数
 */
export function enableWheelScroll(container) {
  if (!container) return () => {};
  const onWheel = (e) => {
    if (e.ctrlKey || e.metaKey) return;
    const max = container.scrollHeight - container.clientHeight;
    if (max <= 0) return;
    const before = container.scrollTop;
    const next = Math.max(0, Math.min(max, before + e.deltaY));
    if (next === before) return;
    container.scrollTop = next;
    e.preventDefault();
  };
  container.addEventListener('wheel', onWheel, { passive: false });
  return () => container.removeEventListener('wheel', onWheel);
}

/**
 * 同上，但用手指：3D 书页里的原生惯性滚动同样不可靠，
 * 这里做「手指跟手 + 直接写 scrollTop」的最小实现。
 * 位移小于 4px 不接管，轻点仍然是点击；到顶/到底就让事件继续冒泡。
 *
 * @param {HTMLElement} container 有 overflow-y:auto 的滚动容器
 * @returns {() => void} 卸载函数
 */
export function enableTouchScroll(container) {
  if (!container) return () => {};
  let startY = 0;
  let startTop = 0;
  let tracking = false;
  let moved = false;

  const onStart = (e) => {
    if (e.touches.length !== 1) {
      tracking = false;
      return;
    }
    tracking = true;
    moved = false;
    startY = e.touches[0].clientY;
    startTop = container.scrollTop;
  };

  const onMove = (e) => {
    if (!tracking || e.touches.length !== 1) return;
    const max = container.scrollHeight - container.clientHeight;
    if (max <= 0) {
      tracking = false;
      return;
    }
    const dy = startY - e.touches[0].clientY;
    if (!moved) {
      if (Math.abs(dy) < 4) return;
      moved = true;
    }
    const next = Math.max(0, Math.min(max, startTop + dy));
    container.scrollTop = next;
    e.preventDefault();
  };

  const onEnd = () => {
    tracking = false;
  };

  container.addEventListener('touchstart', onStart, { passive: true });
  container.addEventListener('touchmove', onMove, { passive: false });
  container.addEventListener('touchend', onEnd, { passive: true });
  container.addEventListener('touchcancel', onEnd, { passive: true });

  return () => {
    container.removeEventListener('touchstart', onStart);
    container.removeEventListener('touchmove', onMove);
    container.removeEventListener('touchend', onEnd);
    container.removeEventListener('touchcancel', onEnd);
  };
}