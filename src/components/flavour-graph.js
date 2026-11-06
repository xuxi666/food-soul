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
  };

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
    const byId = new Map(state.nodes.map((n) => [n.epicure, n]));
    const edgeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const nodeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    gRoot.append(edgeLayer, nodeLayer);

    for (const e of state.edges) {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (!a || !b) continue;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', a.x);
      line.setAttribute('y1', a.y);
      line.setAttribute('x2', b.x);
      line.setAttribute('y2', b.y);
      line.setAttribute('class', `egraph__edge${a.level === 0 || b.level === 0 ? ' is-main' : ''}`);
      line.setAttribute('stroke-opacity', String(Math.min(0.55, 0.12 + e.weight * 0.8)));
      edgeLayer.append(line);
    }

    for (const n of state.nodes) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const catClass = n.cat ? ` cat-${n.cat}` : '';
      g.setAttribute('class', `egraph__node lv${n.level}${catClass}${n.known ? '' : ' is-unknown'}${n.chinaFriendly ? '' : ' is-foreign'}`);
      g.setAttribute('transform', `translate(${n.x},${n.y})`);
      g.dataset.id = n.epicure;

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
      title.textContent = `${n.cn} · ${CAT_LABEL[n.cat] || n.foodGroup || '食材'} · ${sim}${n.known ? '' : ' · 词表未收录'}`;
      g.append(title);

      nodeLayer.append(g);
    }
  }

  function relayoutAndRender() {
    layout();
    render();
    applyView();
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
      state.nodes = [];
      state.edges = [];
      clear(gRoot);
    },
  };
}


export default createGraph;
