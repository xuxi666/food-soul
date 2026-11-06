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

/* ---------------- 页面 ---------------- */

const STYLES = [
  { id: 'home', name: '家常菜', desc: '步骤少、火候宽容，工作日晚餐' },
  { id: 'refined', name: '精致料理', desc: '讲究刀工、层次与摆盘' },
  { id: 'fusion', name: '创意融合', desc: '中式底子，跨风味组合' },
  { id: 'regional', name: '地方风味', desc: '贴近某个地区的家常做法' },
  { id: 'snack', name: '休闲小食', desc: '小吃、点心、下酒菜' },
  { id: 'healthy', name: '健康轻食', desc: '少油少盐，蒸煮炖拌为主' },
  { id: 'random', name: '随机创作', desc: '交给 AI 自由发挥' },
];

const CUISINES = ['不限', '川菜', '粤菜', '鲁菜', '苏菜', '闽菜', '浙菜', '湘菜', '徽菜', '地方风味', '创新融合'];
const TASTES = ['不限', '咸鲜', '麻辣', '酸辣', '甜鲜', '酱香', '清鲜', '浓香'];
const TECHNIQUES = ['不限', '炒', '煎', '炸', '蒸', '煮', '炖', '焖', '烤', '凉拌'];
const SCENES = ['不限', '家常', '宴客', '早餐', '夜宵', '小吃'];
const DIFFS = [
  { id: 'easy', name: '简单' },
  { id: 'medium', name: '中等' },
  { id: 'hard', name: '复杂' },
];
const INNOVS = [
  { id: 'low', name: '传统改良' },
  { id: 'mid', name: '适度创新' },
  { id: 'high', name: '大胆创新' },
];

export default {
  async mount(root) {
    let tab = 'explore';
    let library = null;
    const selected = [];          // { id, cn, epicure, amount, unit, role, required }
    let lastNet = null;

    const form = {
      style: 'home',
      cuisine: '',
      taste: '',
      technique: '',
      scene: '',
      difficulty: 'medium',
      innovation: 'mid',
      servings: 2,
      dishName: '',
      extra: '',
      allowAdd: true,
    };
    const advanced = {
      avoidIngredients: '',
      highlightFlavor: '',
      avoidFlavor: '',
      allowSubstitute: true,
      allowAux: true,
      budget: '',
      maxMinutes: '',
      maxIngredients: '',
    };
    let advOpen = false;
    let result = null;
    let generating = false;
    let genError = '';

    /* ---------------- 风味探索 ---------------- */
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
    const catBar = h('div', { class: 'ek-cats' });

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
                paintList();
                if (tab === 'create') paintCreate();
                void loadNetwork();
              },
            },
            s.cn,
            h('em', { text: '×' })
          )
        );
      }
      selectedBox.append(
        h(
          'button',
          {
            class: 'btn btn--sm ek-goto',
            type: 'button',
            onclick: () => {
              tab = 'create';
              paintTabs();
              paintPanels();
            },
          },
          `带着 ${selected.length} 种食材去创意厨房 →`
        )
      );
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
                  selected.push({ id: it.id, cn: it.cn, epicure: it.epicure, amount: '', unit: 'g', role: 'main', required: true });
                }
                paintSelected();
                paintList();
                if (tab === 'create') paintCreate();
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
      }
    }

    graph.onPick((n) => {
      const hit = library?.items.find((i) => i.epicure === n.epicure);
      if (!hit) {
        toast(`「${n.cn}」未收录进中文食材库，暂不能作为中心`, 'err');
        return;
      }
      selected.length = 0;
      selected.push({ id: hit.id, cn: hit.cn, epicure: hit.epicure, amount: '', unit: 'g', role: 'main', required: true });
      paintSelected();
      paintList();
      if (tab === 'create') paintCreate();
      void loadNetwork();
    });

    searchInput.addEventListener('input', () => paintList());

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
                  if (tab === 'create') paintCreate();
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

    /* ---------------- 创意厨房 ---------------- */
    const createRoot = h('div', { class: 'ek-create' });
    const leftCol = h('div', {});
    const rightCol = h('aside', {});
    const resultHost = h('div', { class: 'ek-result' });
    createRoot.append(leftCol, rightCol);

    const createPanel = h('div', {}, createRoot, resultHost);

    function field(label, control) {
      return h('div', { class: 'ek-field' }, h('span', { class: 'ek-label', text: label }), control);
    }

    function selectOf(options, value, onChange) {
      const sel = h('select', { class: 'ek-select', onchange: (e) => onChange(e.target.value) });
      for (const o of options) {
        const opt = h('option', { value: o, text: o });
        if (o === value) opt.selected = true;
        sel.append(opt);
      }
      return sel;
    }

    function paintCreate() {
      /* --- 食材清单 --- */
      const ingCard = h('div', { class: 'ek-card' }, h('h3', {}, '食材清单', h('em', { text: `${selected.length} 种` })));
      if (!selected.length) {
        ingCard.append(
          h('div', { class: 'ek-empty', text: '还没有食材。去「风味探索」选几种，或直接生成让系统搭配。' })
        );
      } else {
        for (const s of selected) {
          const qty = h('input', {
            class: 'ek-ing__qty',
            type: 'text',
            placeholder: '用量',
            value: s.amount || '',
            oninput: (e) => {
              s.amount = e.target.value.replace(/[^\d.]/g, '').slice(0, 5);
            },
          });
          const role = h(
            'select',
            {
              class: 'ek-ing__role',
              onchange: (e) => {
                s.role = e.target.value;
              },
            },
            h('option', { value: 'main', text: '主要' }),
            h('option', { value: 'aux', text: '辅助' })
          );
          role.value = s.role;
          ingCard.append(
            h(
              'div',
              { class: 'ek-ing' },
              h('span', { class: 'ek-ing__name', text: s.cn }),
              qty,
              role,
              h(
                'button',
                {
                  class: 'ek-ing__del',
                  type: 'button',
                  title: '移除',
                  onclick: () => {
                    const i = selected.findIndex((x) => x.id === s.id);
                    if (i >= 0) selected.splice(i, 1);
                    paintSelected();
                    paintList();
                    paintCreate();
                    void loadNetwork();
                  },
                },
                '×'
              )
            )
          );
        }
        ingCard.append(
          h('p', { class: 'ek-hint', text: '用量可留空，由 AI 按人数估算；「主要」会作为菜品主体。' })
        );
      }
      ingCard.append(
        h(
          'label',
          { class: 'ek-switch' },
          h('input', {
            type: 'checkbox',
            checked: form.allowAdd,
            onchange: (e) => {
              form.allowAdd = e.target.checked;
            },
          }),
          '允许 AI 补充其他食材'
        )
      );

      /* --- 快速创作 --- */
      const styleCard = h('div', { class: 'ek-card' }, h('h3', {}, '快速创作', h('em', { text: '创作风格，不是固定模板' })));
      const styleGrid = h('div', { class: 'ek-styles' });
      for (const s of STYLES) {
        styleGrid.append(
          h(
            'button',
            {
              class: `ek-style${form.style === s.id ? ' is-on' : ''}`,
              type: 'button',
              onclick: () => {
                form.style = s.id;
                paintCreate();
              },
            },
            h('b', { text: s.name }),
            h('span', { text: s.desc })
          )
        );
      }
      styleCard.append(styleGrid);

      /* --- 创意参数 --- */
      const paramCard = h('div', { class: 'ek-card' }, h('h3', {}, '创意参数', h('em', { text: '全部可选' })));
      const row1 = h(
        'div',
        { class: 'ek-field__row' },
        field('菜系方向', selectOf(CUISINES, form.cuisine || '不限', (v) => (form.cuisine = v === '不限' ? '' : v))),
        field('口味倾向', selectOf(TASTES, form.taste || '不限', (v) => (form.taste = v === '不限' ? '' : v)))
      );
      const row2 = h(
        'div',
        { class: 'ek-field__row' },
        field('烹饪方式', selectOf(TECHNIQUES, form.technique || '不限', (v) => (form.technique = v === '不限' ? '' : v))),
        field('用餐场景', selectOf(SCENES, form.scene || '不限', (v) => (form.scene = v === '不限' ? '' : v)))
      );
      const row3 = h(
        'div',
        { class: 'ek-field__row' },
        field(
          '创作难度',
          selectOf(
            DIFFS.map((d) => d.name),
            DIFFS.find((d) => d.id === form.difficulty)?.name || '中等',
            (v) => (form.difficulty = DIFFS.find((d) => d.name === v)?.id || 'medium')
          )
        ),
        field(
          '创新程度',
          selectOf(
            INNOVS.map((d) => d.name),
            INNOVS.find((d) => d.id === form.innovation)?.name || '适度创新',
            (v) => (form.innovation = INNOVS.find((d) => d.name === v)?.id || 'mid')
          )
        )
      );
      const nameInput = h('input', {
        class: 'ek-input',
        type: 'text',
        maxlength: '24',
        placeholder: '留空则由 AI 命名',
        value: form.dishName,
        oninput: (e) => (form.dishName = e.target.value),
      });
      const extraInput = h('textarea', {
        class: 'ek-textarea',
        maxlength: '200',
        placeholder: '例如：用香菇、鸡肉、番茄和花椒做一道从未出现过的川味创新菜',
        oninput: (e) => (form.extra = e.target.value),
      });
      extraInput.value = form.extra;
      const servingsInput = h('input', {
        class: 'ek-input',
        type: 'number',
        min: '1',
        max: '12',
        value: String(form.servings),
        oninput: (e) => (form.servings = Math.min(12, Math.max(1, Number(e.target.value) || 2))),
      });

      paramCard.append(
        row1,
        row2,
        row3,
        h('div', { class: 'ek-field__row' }, field('美食名称', nameInput), field('份量（人）', servingsInput)),
        field('额外要求', extraInput)
      );

      /* --- 高级参数 --- */
      const advCard = h('div', { class: `ek-card ek-adv${advOpen ? ' is-open' : ''}` });
      advCard.append(
        h(
          'button',
          {
            class: 'ek-adv__toggle',
            type: 'button',
            onclick: () => {
              advOpen = !advOpen;
              paintCreate();
            },
          },
          h('em', { text: '▸' }),
          '高级配方参数'
        )
      );
      const advBody = h('div', { class: 'ek-adv__body' });
      const mkInput = (key, placeholder, cls = 'ek-input') =>
        h('input', {
          class: cls,
          type: 'text',
          placeholder,
          value: advanced[key],
          oninput: (e) => (advanced[key] = e.target.value),
        });
      advBody.append(
        h(
          'div',
          { class: 'ek-field__row' },
          field('不使用的食材', mkInput('avoidIngredients', '如：香菜、内脏')),
          field('希望突出的风味', mkInput('highlightFlavor', '如：椒麻、菌香'))
        ),
        h(
          'div',
          { class: 'ek-field__row' },
          field('希望避免的风味', mkInput('avoidFlavor', '如：过甜、腥味')),
          field('预算范围', selectOf(['不限', '经济', '适中', '宽裕'], advanced.budget || '不限', (v) => (advanced.budget = v === '不限' ? '' : v)))
        ),
        h(
          'div',
          { class: 'ek-field__row' },
          field(
            '总时长上限（分钟）',
            h('input', {
              class: 'ek-input',
              type: 'number',
              min: '0',
              max: '600',
              placeholder: '不限',
              value: advanced.maxMinutes,
              oninput: (e) => (advanced.maxMinutes = e.target.value),
            })
          ),
          field(
            '食材种类上限',
            h('input', {
              class: 'ek-input',
              type: 'number',
              min: '0',
              max: '24',
              placeholder: '不限',
              value: advanced.maxIngredients,
              oninput: (e) => (advanced.maxIngredients = e.target.value),
            })
          )
        ),
        h(
          'label',
          { class: 'ek-switch' },
          h('input', {
            type: 'checkbox',
            checked: advanced.allowSubstitute,
            onchange: (e) => (advanced.allowSubstitute = e.target.checked),
          }),
          '允许替代食材'
        ),
        h(
          'label',
          { class: 'ek-switch' },
          h('input', {
            type: 'checkbox',
            checked: advanced.allowAux,
            onchange: (e) => (advanced.allowAux = e.target.checked),
          }),
          '允许添加辅助食材'
        )
      );
      advCard.append(advBody);

      clear(leftCol);
      leftCol.append(ingCard, styleCard, paramCard, advCard);

      /* --- 右侧：生成 --- */
      const submitBtn = h(
        'button',
        {
          class: 'btn btn--solid ek-submit',
          type: 'button',
          disabled: generating,
          onclick: () => void submit(),
        },
        generating ? '正在生成…' : '生成配方'
      );
      const statusBox = h('p', {
        class: 'ek-hint',
        text: generating
          ? '先做 Epicure 风味分析，再交给模型写菜谱，通常 30–60 秒。'
          : genError || '生成结果会显示在下方，可复制或继续调整。',
      });
      clear(rightCol);
      rightCol.append(
        h(
          'div',
          { class: 'ek-card' },
          h('h3', {}, '开始创作', h('em', { text: selected.length ? `${selected.length} 种食材` : 'AI 自由搭配' })),
          submitBtn,
          statusBox
        )
      );
    }

    function renderResult(data) {
      clear(resultHost);
      if (!data) return;
      const r = data.recipe;
      const a = data.analysis || {};
      const tags = h('div', {});
      tags.append(
        h('span', { class: `ek-tag ${r.dish_type === 'original' ? 'ek-tag--origin' : ''}`, text: r.dish_type === 'original' ? 'AI 原创' : '传统菜式' }),
        h('span', { class: 'ek-tag', text: r.cuisine_style }),
        h('span', { class: 'ek-tag', text: `${r.prep_minutes + r.cook_minutes} 分钟` }),
        h('span', { class: 'ek-tag', text: `难度 ${DIFFS.find((d) => d.id === r.difficulty)?.name || r.difficulty}` }),
        h('span', {
          class: `ek-tag ${a.used ? 'ek-tag--epicure' : 'ek-tag--plain'}`,
          text: a.used ? 'Epicure 风味计算' : '普通 AI 创意生成',
        })
      );

      const analysisRows = h('div', { class: 'ek-analysis' });
      if (a.used) {
        if (a.pairs?.length) {
          analysisRows.append(
            h(
              'div',
              { class: 'ek-analysis__row' },
              h('b', { text: '搭配分' }),
              h('span', { text: a.pairs.map((p) => `${p.a}×${p.b} ${p.score.toFixed(3)}${p.label ? `（${p.label}）` : ''}`).join('；') })
            )
          );
        }
        if (r.flavor_design?.pairing_notes) {
          analysisRows.append(
            h('div', { class: 'ek-analysis__row' }, h('b', { text: '搭配思路' }), h('span', { text: r.flavor_design.pairing_notes }))
          );
        }
        if (r.flavor_design?.risk) {
          analysisRows.append(
            h('div', { class: 'ek-analysis__row' }, h('b', { text: '风险提示' }), h('span', { text: r.flavor_design.risk }))
          );
        }
      } else {
        analysisRows.append(
          h('div', {
            class: 'ek-analysis__row',
            text: '本次未取得 Epicure 计算结果，菜谱由模型按中国菜常识生成，未做风味数据校验。',
          })
        );
      }
      if (a.unresolved?.length) {
        analysisRows.append(
          h('div', { class: 'ek-analysis__row' }, h('b', { text: '未识别食材' }), h('span', { text: a.unresolved.join('、') }))
        );
      }

      const ings = h('div', { class: 'ek-ings' });
      for (const it of r.ingredients) {
        ings.append(
          h(
            'div',
            { class: 'ek-ings__row' },
            h('span', { text: it.name }),
            h('span', { text: `${it.amount}${it.unit}` }),
            h('em', { text: it.role === 'main' ? '主料' : '辅料' }),
            it.substitutable ? h('em', { text: '可替代' }) : null
          )
        );
      }

      const steps = h('ol', { class: 'ek-steps' });
      for (const s of r.steps) {
        steps.append(
          h(
            'li',
            {},
            h('b', {}, `${s.step}. ${s.action.slice(0, 18)}${s.action.length > 18 ? '…' : ''}`),
            h('div', { text: s.action }),
            s.heat || s.minutes || s.note
              ? h('div', {}, h('i', { text: [s.heat, s.minutes ? `${s.minutes} 分钟` : '', s.note].filter(Boolean).join(' · ') }))
              : null
          )
        );
      }

      resultHost.append(
        h(
          'div',
          { class: 'ek-card' },
          h('div', { class: 'ek-result__head' }, h('div', {}, h('h2', { class: 'ek-result__title', text: r.dish_name }), tags)),
          h('p', { class: 'ek-hint', text: r.intro }),
          analysisRows,
          h('h3', { style: 'margin-top:16px' }, '食材'),
          ings,
          h('h3', { style: 'margin-top:16px' }, '步骤'),
          steps,
          r.creation_notes ? h('h3', { style: 'margin-top:16px' }, '创作说明') : null,
          r.creation_notes ? h('p', { class: 'ek-hint', text: r.creation_notes }) : null,
          h(
            'div',
            { class: 'ek-result__actions' },
            h('button', { class: 'btn btn--sm', type: 'button', onclick: () => void submit() }, '再生成一次'),
            h('button', { class: 'btn btn--sm btn--solid', type: 'button', onclick: () => openShare(r, data) }, '分享到社区'),
            h('span', { class: 'ek-hint', text: `${data.provider || ''} ${data.model || ''} · ${Math.round((data.ms || 0) / 1000)} 秒` })
          )
        )
      );
    }

    /** 分享到社区：自动填充，全部可改，用户点「发布」才真正提交 */
    function openShare(recipe, data) {
      const ingText = recipe.ingredients.map((i) => `${i.name} ${i.amount}${i.unit}`).join('\n');
      const stepText = recipe.steps.map((s) => s.action).join('\n');

      const titleIn = h('input', { class: 'ek-input', type: 'text', maxlength: '24', value: recipe.dish_name });
      const introIn = h('textarea', { class: 'ek-textarea', maxlength: '160' });
      introIn.value = recipe.intro || '';
      const tasteIn = h('input', {
        class: 'ek-input',
        type: 'text',
        maxlength: '40',
        value: (recipe.flavor_profile || []).join('、'),
        placeholder: '用顿号分隔，如 咸鲜、微辣',
      });
      const ingIn = h('textarea', { class: 'ek-textarea', maxlength: '600' });
      ingIn.value = ingText;
      const stepIn = h('textarea', { class: 'ek-textarea', maxlength: '2000' });
      stepIn.value = stepText;
      const fileIn = h('input', { type: 'file', accept: 'image/*', class: 'ek-input' });
      let uploadedUrl = '';
      let uploading = false;

      const tip = h('p', {
        class: 'ek-modal__tip',
        text: '以下内容已自动填好，都可以改；改完点「发布」才会提交到社区。',
      });
      const publishBtn = h('button', { class: 'btn btn--solid btn--sm', type: 'button' }, '发布');
      const cancelBtn = h('button', { class: 'btn btn--sm', type: 'button' }, '取消');

      const box = h(
        'div',
        { class: 'ek-modal__box' },
        h(
          'div',
          { class: 'ek-modal__head' },
          h('h3', {}, '分享到美食社区'),
          h('button', { class: 'ek-modal__close', type: 'button', onclick: () => close() }, '×')
        ),
        tip,
        field('菜名', titleIn),
        field('简介', introIn),
        h('div', { class: 'ek-field__row' }, field('口味标签', tasteIn), field('成品图（可选）', fileIn)),
        field('食材（每行一个：名称 用量）', ingIn),
        field('步骤（每行一步）', stepIn),
        h('div', { class: 'ek-modal__foot' }, cancelBtn, publishBtn)
      );
      const modal = h('div', { class: 'ek-modal', role: 'dialog', 'aria-modal': 'true' }, box);

      function close() {
        modal.remove();
        document.removeEventListener('keydown', onKey);
      }
      function onKey(e) {
        if (e.key === 'Escape') close();
      }
      document.addEventListener('keydown', onKey);
      modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
      });
      cancelBtn.addEventListener('click', close);

      fileIn.addEventListener('change', async () => {
        const file = fileIn.files?.[0];
        if (!file) return;
        if (file.size > 4 * 1024 * 1024) return toast('图片不要超过 4MB', 'err');
        uploading = true;
        publishBtn.disabled = true;
        publishBtn.textContent = '图片上传中…';
        try {
          const dataUrl = await new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result));
            fr.onerror = reject;
            fr.readAsDataURL(file);
          });
          const res = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ image: dataUrl }),
          });
          const out = await res.json();
          if (!res.ok || !out.ok) throw new Error(out.error || '上传失败');
          uploadedUrl = out.url || out.image || '';
          tip.textContent = '图片已上传，发布时会一并提交。';
        } catch (err) {
          toast(String(err.message || err).slice(0, 40), 'err');
        } finally {
          uploading = false;
          publishBtn.disabled = false;
          publishBtn.textContent = '发布';
        }
      });

      publishBtn.addEventListener('click', async () => {
        const title = titleIn.value.trim();
        const intro = introIn.value.trim();
        if (!title) return toast('菜名不能为空', 'err');
        const ingredients = ingIn.value
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const m = line.match(/^(.*?)[\s　]+([\d.]+)\s*(\D*)$/);
            if (!m) return { name: line.slice(0, 30), amount: 0, unit: '', role: 'main' };
            return { name: m[1].trim().slice(0, 30), amount: Number(m[2]) || 0, unit: (m[3] || '').trim().slice(0, 6), role: 'main' };
          })
          .filter((i) => i.name);
        const steps = stepIn.value
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map((action, i) => ({ step: i + 1, action: action.slice(0, 300), heat: '', minutes: 0 }));
        if (!ingredients.length || !steps.length) return toast('食材和步骤都要有内容', 'err');

        publishBtn.disabled = true;
        publishBtn.textContent = '发布中…';
        try {
          const res = await fetch('/api/posts', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              content: `${intro || title}\n\n（Epicure 厨房生成，食材与步骤见下方菜谱）`.slice(0, 800),
              kind: '菜谱分享',
              images: uploadedUrl ? [uploadedUrl] : [],
              recipe: {
                title,
                intro,
                cuisine: recipe.cuisine_style,
                tastes: tasteIn.value
                  .split(/[、,，\s]+/)
                  .map((t) => t.trim())
                  .filter(Boolean)
                  .slice(0, 5),
                difficulty: recipe.difficulty,
                minutes: (recipe.prep_minutes || 0) + (recipe.cook_minutes || 0),
                ingredients,
                steps,
                flavor: recipe.flavor_design?.pairing_notes || '',
                origin: recipe.dish_type === 'traditional' ? 'traditional' : 'ai-original',
                model: `${data.provider || ''} ${data.model || ''}`.trim(),
              },
            }),
          });
          const out = await res.json();
          if (res.status === 401) {
            toast('请先登录后再分享', 'err');
            return;
          }
          if (!res.ok) throw new Error(out.error || '发布失败');
          close();
          toast('已发布到美食社区');
          location.hash = '';
          setTimeout(() => {
            location.href = '/community';
          }, 400);
        } catch (err) {
          toast(String(err.message || err).slice(0, 40), 'err');
        } finally {
          publishBtn.disabled = false;
          publishBtn.textContent = '发布';
        }
      });

      document.body.append(modal);
      titleIn.focus();
    }

    async function submit() {
      if (generating) return;
      generating = true;
      genError = '';
      paintCreate();
      try {
        const res = await fetch('/api/epicure/create', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ingredients: selected.map((s) => ({ id: s.id, cn: s.cn, amount: s.amount, unit: s.unit, role: s.role })),
            allowAdd: form.allowAdd,
            style: form.style,
            cuisine: form.cuisine,
            taste: form.taste,
            technique: form.technique,
            scene: form.scene,
            difficulty: form.difficulty,
            innovation: form.innovation,
            servings: form.servings,
            dishName: form.dishName,
            extra: form.extra,
            advanced,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          genError = data.error || `请求失败（${res.status}）`;
          result = null;
        } else if (!data.ok) {
          genError = data.error || '生成失败';
          result = null;
        } else {
          result = data;
          renderResult(data);
          // 生成后把结果滚进视野
          requestAnimationFrame(() => resultHost.scrollIntoView({ behavior: 'smooth', block: 'start' }));
        }
      } catch (err) {
        genError = `请求失败：${String(err.message || err).slice(0, 60)}`;
        result = null;
      } finally {
        generating = false;
        paintCreate();
      }
    }

    /* ---------------- 切换 ---------------- */
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

    const panels = h('div', { class: 'ek-panels' });
    function paintPanels() {
      clear(panels);
      if (tab === 'explore') {
        panels.append(explorePanel);
        requestAnimationFrame(() => graph.resize());
      } else {
        panels.append(createPanel);
        paintCreate();
        if (result) renderResult(result);
        else clear(resultHost);
      }
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
