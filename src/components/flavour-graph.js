import { h, clear } from '../lib/dom.js';

const CAT_LABEL = {
  meat: '肉类',
  seafood: '水产',
  veg: '蔬菜',
  fungi: '菌菇',
  grain: '谷物',
  soy: '豆制品',
  dairy: '蛋奶',
  seasoning: '调味料',
  spice: '香辛料',
};

/**
 * 食材风味关系图谱（SVG 力导）
 * 数据来自 /api/epicure/network（真实 neighbors 相似度），前端不生成任何随机连线。
 */

function createGraph(host) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'egraph__svg');
  const gRoot = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.append(gRoot);
  host.append(svg);

  const state = {
    nodes: [],
    edges: [],
    view: { x: 0, y: 0, k: 1 },
    drag: null,
    pan: null,
    onPick: null,
    nodeEls: new Map(),   // epicure -> <g>
    edgeEls: [],          // { line, from, to }
    byId: new Map(),      // epicure -> node
    raf: 0,
    t0: 0,
  };

  /* ---- 漂浮动画：参数由稳定 ID 推导，不用随机数，刷新/重排后节奏不变 ---- */
  function hash01(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967295;
  }

  function floatParams(node, idx) {
    const key = String(node.epicure || idx);
    const a = hash01(key);
    const b = hash01(`${key}#y`);
    const c = hash01(`${key}#p`);
    return {
      ampY: 3 + b * 5,                 // 垂直 3–8px
      ampX: c * 3,                     // 水平 0–3px
      period: 4000 + a * 4000,         // 周期 4–8s
      phase: a * Math.PI * 2,          // 相位错开
    };
  }

  const reduceMotion =
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : { matches: false };

  function offsetOf(n, now) {
    const p = n._float;
    if (!p) return { dx: 0, dy: 0 };
    // 正在拖这个节点时暂停它的漂浮，避免和鼠标抢位置
    if (dragging === n) return { dx: 0, dy: 0 };
    const w = ((now - state.t0) / p.period) * Math.PI * 2;
    return {
      dx: Math.sin(w + p.phase) * p.ampX,
      dy: Math.sin(w + p.phase * 1.37) * p.ampY,
    };
  }

  function tick(now) {
    state.raf = requestAnimationFrame(tick);
    if (document.hidden) return;   // 后台标签页不算
    if (!state.nodes.length) return;
    for (const n of state.nodes) {
      const { dx, dy } = offsetOf(n, now);
      n._fx = dx;
      n._fy = dy;
      const el = state.nodeEls.get(n.epicure);
      if (el) el.setAttribute('transform', `translate(${n.x + dx},${n.y + dy})`);
    }
    for (const e of state.edgeEls) {
      const a = state.byId.get(e.from);
      const b = state.byId.get(e.to);
      if (!a || !b) continue;
      e.line.setAttribute('x1', a.x + (a._fx || 0));
      e.line.setAttribute('y1', a.y + (a._fy || 0));
      e.line.setAttribute('x2', b.x + (b._fx || 0));
      e.line.setAttribute('y2', b.y + (b._fy || 0));
    }
  }

  function startFloat() {
    if (state.raf || reduceMotion.matches) return;
    state.t0 = performance.now();
    state.raf = requestAnimationFrame(tick);
  }

  function stopFloat() {
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
  }

  function applyView() {
    const { x, y, k } = state.view;
    gRoot.setAttribute('transform', `translate(${x},${y}) scale(${k})`);
  }

  function size() {
    const r = host.getBoundingClientRect();
    return { w: r.width || 800, h: r.height || 520 };
  }

  function radiusOf(n) {
    if (n.level === 0) return 26;
    if (n.level === 1) return 18;
    return 13;
  }

  /** 力导布局：中心固定，其余按斥力/弹簧收敛 */
  function layout() {
    const { w, h } = size();
    const cx = w / 2;
    const cy = h / 2;
    const nodes = state.nodes;
    nodes.forEach((n, i) => {
      if (n.level === 0) {
        const idx = nodes.filter((m) => m.level === 0).indexOf(n);
        const total = nodes.filter((m) => m.level === 0).length || 1;
        const ang = (Math.PI * 2 * idx) / total - Math.PI / 2;
        n.x = cx + (total > 1 ? Math.cos(ang) * 90 : 0);
        n.y = cy + (total > 1 ? Math.sin(ang) * 90 : 0);
        n.fixed = true;
      } else if (n.x === undefined) {
        const ang = (i / nodes.length) * Math.PI * 2;
        const rad = n.level === 1 ? 180 : 280;
        n.x = cx + Math.cos(ang) * rad;
        n.y = cy + Math.sin(ang) * rad;
      }
    });

    const byId = new Map(nodes.map((n) => [n.epicure, n]));
    for (let tick = 0; tick < 160; tick += 1) {
      // 斥力
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            dx = Math.random() - 0.5;
            dy = Math.random() - 0.5;
            d2 = 1;
          }
          const d = Math.sqrt(d2);
          const rep = (a.level === 0 || b.level === 0 ? 26000 : 12000) / d2;
          const fx = (dx / d) * rep;
          const fy = (dy / d) * rep;
          if (!a.fixed) {
            a.x -= fx;
            a.y -= fy;
          }
          if (!b.fixed) {
            b.x += fx;
            b.y += fy;
          }
        }
      }
      // 弹簧（边越长拉得越紧）
      for (const e of state.edges) {
        const a = byId.get(e.from);
        const b = byId.get(e.to);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const rest = a.level === 0 || b.level === 0 ? 150 : 90;
        const force = (d - rest) * 0.02;
        const fx = (dx / d) * force;
        const fy = (dy / d) * force;
        if (!a.fixed) {
          a.x += fx;
          a.y += fy;
        }
        if (!b.fixed) {
          b.x -= fx;
          b.y -= fy;
        }
      }
      // 向心，防止飞散
      for (const n of nodes) {
        if (n.fixed) continue;
        n.x += (cx - n.x) * 0.004;
        n.y += (cy - n.y) * 0.004;
      }
      // 收进画布，避免节点被裁掉
      const pad = 58;
      for (const n of nodes) {
        n.x = Math.min(w - pad, Math.max(pad, n.x));
        n.y = Math.min(h - pad - 10, Math.max(pad, n.y));
      }
    }
  }

  function render() {
    clear(gRoot);
    state.nodeEls.clear();
    state.edgeEls = [];
    const byId = new Map(state.nodes.map((n) => [n.epicure, n]));
    state.byId = byId;
    // 每个节点分配一次稳定参数；已存在的沿用，避免重排后节奏跳变
    state.nodes.forEach((n, i) => {
      if (!n._float) n._float = floatParams(n, i);
    });
    const edgeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const nodeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    gRoot.append(edgeLayer, nodeLayer);

    for (const e of state.edges) {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (!a || !b) continue;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', a.x + (a._fx || 0));
      line.setAttribute('y1', a.y + (a._fy || 0));
      line.setAttribute('x2', b.x + (b._fx || 0));
      line.setAttribute('y2', b.y + (b._fy || 0));
      line.setAttribute('class', `egraph__edge${a.level === 0 || b.level === 0 ? ' is-main' : ''}`);
      line.setAttribute('stroke-opacity', String(Math.min(0.55, 0.12 + e.weight * 0.8)));
      edgeLayer.append(line);
      state.edgeEls.push({ line, from: e.from, to: e.to });
    }

    for (const n of state.nodes) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const catClass = n.cat ? ` cat-${n.cat}` : '';
      g.setAttribute('class', `egraph__node lv${n.level}${catClass}${n.known ? '' : ' is-unknown'}${n.chinaFriendly ? '' : ' is-foreign'}`);
      g.setAttribute('transform', `translate(${n.x + (n._fx || 0)},${n.y + (n._fy || 0)})`);
      g.dataset.id = n.epicure;
      state.nodeEls.set(n.epicure, g);

      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('r', radiusOf(n));
      g.append(c);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dy', radiusOf(n) + 14);
      label.textContent = n.cn;
      g.append(label);

      if (n.level > 0) {
        const badge = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        badge.setAttribute('class', 'egraph__plus');
        badge.setAttribute('transform', `translate(${radiusOf(n) - 2},${-radiusOf(n) + 2})`);
        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bg.setAttribute('r', 7);
        badge.append(bg);
        const plus = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        plus.setAttribute('text-anchor', 'middle');
        plus.setAttribute('dy', '3.2');
        plus.textContent = '+';
        badge.append(plus);
        g.append(badge);
      }

      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      const sim = n.level === 0 ? '当前中心' : `相似度 ${Number(n.sim).toFixed(3)}`;
      title.textContent =
        n.translated === false
          ? `${n.original || n.epicure} · 未收录中文名`
          : `${n.cn} · ${CAT_LABEL[n.cat] || n.foodGroup || '食材'} · ${sim}`;
      g.append(title);

      nodeLayer.append(g);
    }
  }

  function relayoutAndRender() {
    layout();
    render();
    applyView();
    startFloat();
  }

  /* ---- 交互 ---- */
  let dragging = null;
  let moved = false;

  svg.addEventListener('pointerdown', (e) => {
    const nodeEl = e.target.closest('.egraph__node');
    if (nodeEl) {
      const n = state.nodes.find((m) => m.epicure === nodeEl.dataset.id);
      if (n) {
        dragging = n;
        moved = false;
        n.fixed = true;
        svg.setPointerCapture(e.pointerId);
      }
      return;
    }
    state.pan = { x: e.clientX, y: e.clientY, vx: state.view.x, vy: state.view.y };
    svg.setPointerCapture(e.pointerId);
  });

  svg.addEventListener('pointermove', (e) => {
    if (dragging) {
      const rect = svg.getBoundingClientRect();
      const k = state.view.k;
      dragging.x = (e.clientX - rect.left - state.view.x) / k;
      dragging.y = (e.clientY - rect.top - state.view.y) / k;
      moved = true;
      render();
      applyView();
      return;
    }
    if (state.pan) {
      state.view.x = state.pan.vx + (e.clientX - state.pan.x);
      state.view.y = state.pan.vy + (e.clientY - state.pan.y);
      applyView();
    }
  });

  svg.addEventListener('pointerup', (e) => {
    if (dragging) {
      const n = dragging;
      dragging = null;
      if (!moved && state.onPick) state.onPick(n);
      return;
    }
    state.pan = null;
  });

  svg.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const k = Math.min(2.2, Math.max(0.45, state.view.k * delta));
      state.view.x = mx - ((mx - state.view.x) * k) / state.view.k;
      state.view.y = my - ((my - state.view.y) * k) / state.view.k;
      state.view.k = k;
      applyView();
    },
    { passive: false }
  );

  return {
    setData(net) {
      state.nodes = net.nodes.map((n) => ({ ...n }));
      state.edges = net.edges.slice();
      state.view = { x: 0, y: 0, k: 1 };
      relayoutAndRender();
    },
    onPick(fn) {
      state.onPick = fn;
    },
    zoom(factor) {
      state.view.k = Math.min(2.2, Math.max(0.45, state.view.k * factor));
      applyView();
    },
    reset() {
      state.view = { x: 0, y: 0, k: 1 };
      relayoutAndRender();
    },
    resize() {
      relayoutAndRender();
    },
    empty() {
      stopFloat();
      state.nodes = [];
      state.edges = [];
      state.nodeEls.clear();
      state.edgeEls = [];
      clear(gRoot);
    },
    /** 组件销毁时停掉动画循环 */
    destroy() {
      stopFloat();
      state.nodes = [];
      state.edges = [];
      state.nodeEls.clear();
      state.edgeEls = [];
    },
  };
}


export default createGraph;
