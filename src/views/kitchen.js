import { h, clear, toast } from '../lib/dom.js';

/**
 * Epicure 厨房
 * - 风味探索：左侧真实关系网络（数据来自 /api/epicure/network → Epicure neighbors）
 * - 创意厨房：食材清单 + 创作参数（生成流程在后续版本接入）
 *
 * 约定：图上任何一条边都必须来自服务端返回的相似度，前端不生成随机关系。
 */

const TABS = [
  { id: 'explore', label: '风味探索' },
  { id: 'create', label: '创意厨房' },
];

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

/* ---------------- 关系网络（SVG + 简易力导） ---------------- */
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
      g.setAttribute('class', `egraph__node lv${n.level}${n.known ? '' : ' is-unknown'}${n.chinaFriendly ? '' : ' is-foreign'}`);
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

/* ---------------- 页面 ---------------- */
export default {
  async mount(root) {
    let tab = 'explore';
    let library = null;
    const selected = [];          // [{id, cn, epicure}]
    let lastNet = null;
    let loading = false;

    const graphHost = h('div', { class: 'egraph' });
    const graph = createGraph(graphHost);

    const statusLine = h('p', { class: 'ek-status', text: '正在连接 Epicure…' });
    const selectedBox = h('div', { class: 'ek-selected' });
    const listBox = h('div', { class: 'ek-list' });
    const searchInput = h('input', {
      class: 'field__input ek-search',
      type: 'search',
      placeholder: '搜索食材，如 香菇 / 豆腐 / 花椒',
      'aria-label': '搜索食材',
    });
    const countLabel = h('span', { class: 'ek-count', text: '已选 0' });

    let activeCat = 'all';

    function paintSelected() {
      clear(selectedBox);
      countLabel.textContent = `已选 ${selected.length}`;
      if (!selected.length) {
        selectedBox.append(h('p', { class: 'ek-hint', text: '从右侧食材库选 1–4 种，查看它们真实的风味关联。' }));
        return;
      }
      for (const s of selected) {
        selectedBox.append(
          h(
            'button',
            {
              class: 'ek-chip',
              type: 'button',
              title: '点击移除',
              onclick: () => {
                const i = selected.findIndex((x) => x.id === s.id);
                if (i >= 0) selected.splice(i, 1);
                paintSelected();
                void loadNetwork();
              },
            },
            s.cn,
            h('em', { text: '×' })
          )
        );
      }
    }

    function paintList() {
      clear(listBox);
      if (!library) return;
      const q = searchInput.value.trim().toLowerCase();
      const items = library.items.filter((it) => {
        if (activeCat !== 'all' && it.cat !== activeCat) return false;
        if (!q) return true;
        return it.cn.includes(q) || it.epicure.includes(q) || (it.aliases || []).some((a) => a.includes(q));
      });
      if (!items.length) {
        listBox.append(h('p', { class: 'ek-hint', text: '没有匹配的食材，换个词试试。' }));
        return;
      }
      for (const it of items) {
        const on = selected.some((s) => s.id === it.id);
        listBox.append(
          h(
            'button',
            {
              class: `ek-item${on ? ' is-on' : ''}`,
              type: 'button',
              onclick: () => {
                if (on) {
                  const i = selected.findIndex((s) => s.id === it.id);
                  if (i >= 0) selected.splice(i, 1);
                } else {
                  if (selected.length >= 4) return toast('最多同时选 4 种食材', 'err');
                  selected.push({ id: it.id, cn: it.cn, epicure: it.epicure });
                }
                paintSelected();
                paintList();
                void loadNetwork();
              },
            },
            h('span', { class: 'ek-item__cn', text: it.cn }),
            h('span', { class: 'ek-item__meta', text: CAT_LABEL[it.cat] || '' })
          )
        );
      }
    }

    async function loadNetwork() {
      if (!selected.length) {
        graph.empty();
        statusLine.textContent = '选择食材后，这里会显示 Epicure 计算的真实风味关联。';
        return;
      }
      loading = true;
      statusLine.textContent = '正在向 Epicure 请求风味关联…';
      try {
        const res = await fetch('/api/epicure/network', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids: selected.map((s) => s.id), topK: 8, depth: 2, expand: 2 }),
        });
        const data = await res.json();
        if (!res.ok || data.ok === false) {
          statusLine.textContent = `未能获取关联：${data.error || res.status}`;
          return;
        }
        lastNet = data;
        graph.setData(data);
        statusLine.textContent = `Epicure 实时计算 · ${data.stats.nodes} 个节点 / ${data.stats.edges} 条关联${
          data.unresolved?.length ? ` · 未识别：${data.unresolved.join('、')}` : ''
        }`;
      } catch (err) {
        statusLine.textContent = `请求失败：${String(err.message || err).slice(0, 60)}`;
      } finally {
        loading = false;
      }
    }

    graph.onPick((n) => {
      // 点击节点 → 以它为中心重新探索
      const hit = library?.items.find((i) => i.epicure === n.epicure);
      if (!hit) {
        toast(`「${n.cn}」未收录进中文食材库，暂不能作为中心`, 'err');
        return;
      }
      selected.length = 0;
      selected.push({ id: hit.id, cn: hit.cn, epicure: hit.epicure });
      paintSelected();
      paintList();
      void loadNetwork();
    });

    searchInput.addEventListener('input', () => paintList());

    const catBar = h('div', { class: 'ek-cats' });
    function paintCats() {
      clear(catBar);
      const all = [{ id: 'all', name: '全部' }, ...(library?.categories || [])];
      for (const c of all) {
        catBar.append(
          h(
            'button',
            {
              class: `ek-cat${activeCat === c.id ? ' is-on' : ''}`,
              type: 'button',
              onclick: () => {
                activeCat = c.id;
                paintCats();
                paintList();
              },
            },
            c.name
          )
        );
      }
    }

    const tabsBar = h('div', { class: 'seg ek-tabs' });
    function paintTabs() {
      clear(tabsBar);
      for (const t of TABS) {
        tabsBar.append(
          h(
            'button',
            {
              class: `seg__btn${tab === t.id ? ' is-on' : ''}`,
              type: 'button',
              onclick: () => {
                if (tab === t.id) return;
                tab = t.id;
                paintTabs();
                paintPanels();
              },
            },
            t.label
          )
        );
      }
    }

    const explorePanel = h(
      'div',
      { class: 'ek-explore' },
      h(
        'div',
        { class: 'ek-graphpane' },
        h(
          'div',
          { class: 'ek-graphpane__head' },
          h('span', { class: 'ek-graphpane__title', text: '食材风味关系网络' }),
          h(
            'div',
            { class: 'ek-tools' },
            h('button', { class: 'ek-tool', type: 'button', title: '放大', onclick: () => graph.zoom(1.2) }, '＋'),
            h('button', { class: 'ek-tool', type: 'button', title: '缩小', onclick: () => graph.zoom(0.85) }, '－'),
            h('button', { class: 'ek-tool', type: 'button', title: '重置视图', onclick: () => graph.reset() }, '⟲'),
            h(
              'button',
              {
                class: 'ek-tool',
                type: 'button',
                title: '清空选择',
                onclick: () => {
                  selected.length = 0;
                  paintSelected();
                  paintList();
                  void loadNetwork();
                },
              },
              '清空'
            )
          )
        ),
        graphHost,
        statusLine
      ),
      h(
        'aside',
        { class: 'ek-side' },
        h('div', { class: 'ek-side__head' }, h('span', { text: '食材库' }), countLabel),
        searchInput,
        catBar,
        listBox,
        h('div', { class: 'ek-side__foot' }, selectedBox)
      )
    );

    const createPanel = h(
      'div',
      { class: 'ek-create' },
      h('div', { class: 'ek-card' },
        h('h3', { text: '创意厨房' }),
        h('p', { class: 'ek-hint', text: '把风味探索里选好的食材带进来，按中国菜的烹饪逻辑创作。生成流程正在接入。' }),
        h('p', { class: 'ek-hint', text: '当前选择会显示在「风味探索」右侧底部。' })
      )
    );

    const panels = h('div', { class: 'ek-panels' });
    function paintPanels() {
      clear(panels);
      panels.append(tab === 'explore' ? explorePanel : createPanel);
      if (tab === 'explore') requestAnimationFrame(() => graph.resize());
    }

    const page = h(
      'div',
      { class: 'page ek-page' },
      h(
        'div',
        { class: 'wrap' },
        h(
          'div',
          { class: 'page-head' },
          h('a', { class: 'page-head__back', href: '/', 'data-link': '' }, '← 返回'),
          h(
            'div',
            {},
            h('h1', { class: 'page-head__title', text: 'Epicure 厨房' }),
            h('p', { class: 'page-head__sub', text: 'FLAVOUR INTELLIGENCE · 真实风味计算 + 中国菜创作' })
          ),
          h('div', { class: 'page-head__spacer' }),
          h('a', { class: 'btn btn--sm', href: '/recipe', 'data-link': '' }, '结构化菜谱')
        ),
        h('div', { class: 'ek-bar' }, tabsBar),
        panels
      )
    );

    root.append(page);
    paintTabs();
    paintPanels();
    paintSelected();

    // 加载食材库
    try {
      const res = await fetch('/api/epicure/ingredients');
      library = await res.json();
      paintCats();
      paintList();
      statusLine.textContent = `食材库 ${library.items.length} 条（Epicure 已验证 ${library.verified}）· 选择食材后显示真实关联`;
    } catch (err) {
      statusLine.textContent = '食材库加载失败，请刷新重试';
    }

    const onResize = () => {
      if (tab === 'explore') graph.resize();
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
    };
  },
};
