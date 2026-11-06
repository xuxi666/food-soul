import { h, clear, toast } from '../lib/dom.js';
import createGraph from '../components/flavour-graph.js';
import { epicurePanel } from '../components/epicure-panel.js';

/**
 * Epicure 厨房
 *
 * 结构对齐参考站 Enter Kitchen：
 *   食材风味图谱（左）+ 食材库（右）
 *   → 模式（向导 / 标准 / 专业）
 *   → 配方面板（食材 / 快速开始 / 菜系 / 高级参数 / 生成）
 *   → 结果
 *
 * 数据一律来自 Epicure MCP；拿不到就显示不可用，不编造。
 */

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

const MODES = [
  { id: 'wizard', name: '向导', desc: '只填食材与菜式，其余交给系统' },
  { id: 'standard', name: '标准', desc: '完整参数，推荐日常使用' },
  { id: 'pro', name: '专业', desc: '全部参数 + 工具调用明细' },
];

/** 中国化的菜式形态 */
const DISH_TYPES = ['主菜', '汤羹', '前菜', '点心', '凉菜', '小食'];

/** 中国化的出品定位 */
const COMPLEXITY = [
  { id: '家常', name: '家常', desc: '家常灶具，步骤少，火候宽容' },
  { id: '小馆', name: '小馆', desc: '馆子水准，讲究锅气与层次' },
  { id: '宴席', name: '宴席', desc: '宴客规格，注重造型与工序' },
  { id: '清简', name: '清简', desc: '少油少盐，蒸煮炖拌为主' },
];

const FLAVORS = ['咸鲜', '甜润'];

/** 8 张快速开始卡：菜式 × 定位 的随机配对，分咸鲜/甜润两组 */
function buildQuickStart() {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const cards = [];
  const used = new Set();
  for (let i = 0; i < 8; i += 1) {
    let combo = '';
    let dt = '';
    let cp = '';
    let guard = 0;
    do {
      dt = pick(DISH_TYPES);
      cp = pick(COMPLEXITY).id;
      combo = `${dt}|${cp}`;
      guard += 1;
    } while (used.has(combo) && guard < 40);
    used.add(combo);
    cards.push({ dishType: dt, complexity: cp, group: i < 4 ? '咸鲜' : '甜润' });
  }
  return cards;
}

export default {
  async mount(root) {
    const selected = [];       // { id, cn, epicure, cat, vegetarian, vegan }
    let vegOnly = false;
    let plantBased = false;
    let autoCount = 1;
    let cuisineContext = '';
    let mode = 'standard';
    let quickCards = buildQuickStart();
    let pickedCard = 0;
    let advOpen = false;
    let activeTab = 'popular';
    let catOpen = false;
    let searchText = '';
    let generating = false;
    let genError = '';
    let result = null;
    let lastNet = null;

    const advanced = {
      flavorProfile: '咸鲜',
      dishType: '主菜',
      complexity: '家常',
      servings: 4,
      specialRequests: '',
    };

    /* ---------------- 图谱 ---------------- */
    const graphHost = h('div', { class: 'egraph' });
    const graph = createGraph(graphHost);
    const graphLoading = h('div', { class: 'ek-graphloading', hidden: true }, h('span', { class: 'ek-spinner' }), '正在计算风味关联…');
    const statusLine = h('p', { class: 'ek-status', text: '选择食材后显示 Epicure 计算的真实关联' });

    graph.onPick((n) => {
      if (!n?.epicure) return;
      addIngredient({ id: n.epicure, cn: n.cn || n.epicure, epicure: n.epicure, cat: n.cat, vegetarian: true, vegan: false });
    });

    /* ---------------- 食材操作 ---------------- */
    function addIngredient(item) {
      if (selected.some((s) => s.id === item.id)) return;
      if (selected.length >= 8) return toast('最多同时选 8 种食材', 'err');
      selected.push({
        id: item.id,
        cn: item.cn,
        epicure: item.epicure,
        cat: item.cat,
        vegetarian: item.vegetarian,
        vegan: item.vegan,
      });
      refresh();
    }

    function removeIngredient(id) {
      const i = selected.findIndex((s) => s.id === id);
      if (i >= 0) selected.splice(i, 1);
      refresh();
    }

    function refresh() {
      paintChips();
      paintList();
      paintRecipe();
      void loadNetwork();
    }

    /* ---------------- 网络 ---------------- */
    async function loadNetwork() {
      if (!selected.length) {
        graph.empty();
        statusLine.textContent = '选择食材后显示 Epicure 计算的真实关联';
        return;
      }
      statusLine.textContent = '正在向 Epicure 请求风味关联…';
      graphLoading.hidden = false;
      const startedAt = Date.now();
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
        if (!data.stats.edges && data.noData?.length) {
          statusLine.textContent = `「${data.noData.join('、')}」在 Epicure 里暂时查不到风味关联（可能命名不一致或该食材无数据），未做任何推测。`;
        } else {
          statusLine.textContent = `Epicure 实时计算 · ${data.stats.nodes} 个节点 / ${data.stats.edges} 条关联 · ${
            (Date.now() - startedAt) / 1000
          }s${data.unresolved?.length ? ` · 未识别：${data.unresolved.join('、')}` : ''}`;
        }
      } catch (err) {
        statusLine.textContent = `请求失败：${String(err.message || err).slice(0, 60)}`;
      } finally {
        graphLoading.hidden = true;
      }
    }

    /* ---------------- 图谱卡 ---------------- */
    const chipsBox = h('div', { class: 'ek-chips' });
    const autoNum = h('input', {
      class: 'ek-num',
      type: 'number',
      min: '1',
      max: '4',
      value: String(autoCount),
      oninput: (e) => {
        autoCount = Math.min(4, Math.max(1, Number(e.target.value) || 1));
      },
    });
    const autoBtn = h('button', { class: 'ek-btn', type: 'button' }, '自动补充');
    const cuisineCtx = h('input', {
      class: 'ek-input ek-ctx',
      type: 'text',
      placeholder: '菜系语境（可选），如 川菜 / 江南 / 西北',
      maxlength: '30',
      oninput: (e) => {
        cuisineContext = e.target.value;
      },
    });

    autoBtn.addEventListener('click', async () => {
      if (!selected.length) return toast('先选一个食材', 'err');
      autoBtn.disabled = true;
      autoBtn.textContent = '补充中…';
      try {
        const res = await fetch('/api/epicure/autoadd', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ids: selected.map((s) => s.id),
            count: autoCount,
            vegetarian: vegOnly,
            plantBased,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || '未取得搭配');
        let added = 0;
        for (const it of data.items || []) {
          if (selected.some((s) => s.id === it.id)) continue;
          if (selected.length >= 8) break;
          selected.push({ id: it.id, cn: it.cn, epicure: it.epicure, cat: it.cat || null, vegetarian: true, vegan: false });
          added += 1;
        }
        if (!added) toast('没有找到可补充的食材', 'err');
        else toast(`已补充 ${added} 种`);
        refresh();
      } catch (err) {
        toast(String(err.message || err).slice(0, 40), 'err');
      } finally {
        autoBtn.disabled = false;
        autoBtn.textContent = '自动补充';
      }
    });

    function paintChips() {
      clear(chipsBox);
      if (!selected.length) {
        chipsBox.append(h('span', { class: 'ek-hint', text: '还没有食材。从右侧食材库点选，或点图谱里的「+」。' }));
        return;
      }
      for (const s of selected) {
        chipsBox.append(
          h(
            'button',
            { class: 'ek-chip', type: 'button', title: '移除', onclick: () => removeIngredient(s.id) },
            s.cn,
            h('em', { text: '×' })
          )
        );
      }
      chipsBox.append(h('span', { class: 'ek-count', text: `已选 ${selected.length}` }));
    }

    const vegSwitch = h('input', {
      type: 'checkbox',
      onchange: (e) => {
        vegOnly = e.target.checked;
        void loadCatalog({ reset: true });
      },
    });
    const veganSwitch = h('input', {
      type: 'checkbox',
      onchange: (e) => {
        plantBased = e.target.checked;
        void loadCatalog({ reset: true });
      },
    });

    const graphCard = h(
      'section',
      { class: 'ek-card ek-graph-card' },
      h(
        'div',
        { class: 'ek-card__head' },
        h('b', { text: '食材风味图谱' }),
        h(
          'div',
          { class: 'ek-toggles' },
          h('label', { class: 'ek-switch' }, vegSwitch, '素食'),
          h('label', { class: 'ek-switch' }, veganSwitch, '纯素'),
          h(
            'button',
            {
              class: 'ek-tool',
              type: 'button',
              title: '清空',
              onclick: () => {
                selected.length = 0;
                refresh();
              },
            },
            '清空'
          )
        )
      ),
      chipsBox,
      h('div', { class: 'ek-toolbar' }, autoBtn, autoNum, cuisineCtx),
      h(
        'div',
        { class: 'ek-canvas' },
        graphHost,
        graphLoading,
        h(
          'div',
          { class: 'ek-zoom' },
          h('button', { class: 'ek-tool ek-tool--round', type: 'button', title: '放大', onclick: () => graph.zoom(1.2) }, '＋'),
          h('button', { class: 'ek-tool ek-tool--round', type: 'button', title: '缩小', onclick: () => graph.zoom(0.85) }, '－'),
          h('button', { class: 'ek-tool ek-tool--round', type: 'button', title: '重置', onclick: () => graph.reset() }, '⟲')
        )
      ),
      statusLine
    );

    /* ---------------- 食材库（服务端搜索 + 分页） ---------------- */
    const searchInput = h('input', {
      class: 'field__input ek-search',
      type: 'search',
      placeholder: '搜索食材（中文 / 英文）…',
      'aria-label': '搜索食材',
    });
    const tabsBar = h('div', { class: 'ek-tabs2' });
    const catBar = h('div', { class: 'ek-catbar' });
    const countLine = h('p', { class: 'ek-hint ek-catalog-count', text: '加载中…' });
    const listBox = h('div', { class: 'ek-list' });
    const moreBtn = h('button', { class: 'ek-more', type: 'button', hidden: true }, '加载更多');

    const TABS = [
      { id: 'all', name: '全部' },
      { id: 'popular', name: '常用' },
    ];

    const cat = {
      q: '',
      category: 'all',
      mode: 'popular',
      page: 1,
      total: 0,
      items: [],
      hasMore: false,
      stats: null,
      loading: false,
    };

    function paintTabs2() {
      clear(tabsBar);
      for (const t of TABS) {
        tabsBar.append(
          h(
            'button',
            {
              class: `ek-tab${cat.mode === t.id ? ' is-on' : ''}`,
              type: 'button',
              onclick: () => {
                cat.mode = t.id;
                paintTabs2();
                void loadCatalog({ reset: true });
              },
            },
            t.name
          )
        );
      }
    }

    /** 分类面板：默认收起，点「全部分类」展开；分类数据全部来自接口，新增分类自动出现 */
    function paintCatBar() {
      clear(catBar);
      const list = cat.stats?.categories || [];
      const current = cat.category === 'all' ? null : list.find((c) => c.id === cat.category);

      // 头部：切换展开 / 收起（只控制展开，不改筛选）
      catBar.append(
        h(
          'button',
          {
            class: `ek-cathead${catOpen ? ' is-open' : ''}`,
            type: 'button',
            'aria-expanded': catOpen ? 'true' : 'false',
            onclick: () => {
              catOpen = !catOpen;
              paintCatBar();
            },
          },
          h('span', { class: 'ek-cathead__text', text: `全部分类（${list.length}）` }),
          current ? h('span', { class: 'ek-cathead__cur', text: current.name }) : null,
          h('em', { class: 'ek-cathead__arrow', text: '⌄' })
        )
      );

      // 展开面板：全部 + 各分类，自动换行
      const grid = h('div', { class: 'ek-catgrid' });
      const chips = [{ id: 'all', name: '全部', count: 0 }, ...list];
      for (const c of chips) {
        grid.append(
          h(
            'button',
            {
              class: `ek-cat${cat.category === c.id ? ' is-on' : ''}`,
              type: 'button',
              title: c.count ? `${c.count} 种食材` : '不限分类',
              onclick: () => {
                if (cat.category === c.id) return;
                cat.category = c.id;
                paintCatBar();
                void loadCatalog({ reset: true });
              },
            },
            c.count ? `${c.name} ${c.count}` : c.name
          )
        );
      }

      catBar.append(
        h('div', { class: `ek-catpanel${catOpen ? ' is-open' : ''}` }, h('div', { class: 'ek-catpanel__inner' }, grid))
      );

      // 展开时把食材库整体放高一点，避免列表被压得太扁
      document.querySelector('.ek-catalog')?.classList.toggle('is-catopen', catOpen);

      // 展开时把食材库整体放高一点，避免列表被压得太扁
      document.querySelector('.ek-catalog')?.classList.toggle('is-catopen', catOpen);
    }

    function paintCounts() {
      if (!cat.stats) {
        countLine.textContent = '目录加载中…';
        return;
      }
      const n = (v) => Number(v || 0).toLocaleString('zh-CN');
      const sync = cat.stats.lastSyncAt ? new Date(cat.stats.lastSyncAt).toLocaleDateString('zh-CN') : '未同步';
      const scope = cat.q ? `匹配 ${n(cat.total)} 条` : `本类 ${n(cat.total)} 条`;
      const noData = Number(cat.stats.unanalyzable || 0);
      countLine.textContent = `${scope} · 目录 ${n(cat.stats.total)} 种（可分析 ${n(cat.stats.analyzable)}${
        noData ? ` · 暂无风味 ${n(noData)}` : ''
      }）· 同步于 ${sync}`;
    }

    function paintList() {
      clear(listBox);
      if (cat.loading && !cat.items.length) {
        listBox.append(h('p', { class: 'ek-hint', text: '加载中…' }));
        return;
      }
      if (!cat.items.length) {
        listBox.append(h('p', { class: 'ek-hint', text: cat.q ? `没有匹配「${cat.q}」的食材` : '没有食材' }));
        return;
      }
      for (const it of cat.items) {
        const on = selected.some((s) => s.id === it.name);
        listBox.append(
          h(
            'button',
            {
              class: `ek-item${on ? ' is-on' : ''}${it.analyzable ? '' : ' is-nodata'}`,
              type: 'button',
              title: `${it.display}${it.name !== it.display ? ` · ${it.name}` : ''} · ${it.categoryCn}${
                it.analyzable ? '' : ' · Epicure 暂无风味数据'
              }`,
              onclick: () => {
                if (on) removeIngredient(it.name);
                else
                  addIngredient({
                    id: it.name,
                    cn: it.display,
                    epicure: it.name,
                    cat: null,
                    vegetarian: it.isVegetarian,
                    vegan: it.isVegan,
                  });
              },
            },
            h('span', { class: 'ek-item__cn', text: it.display }),
            h('span', { class: 'ek-item__meta', text: it.categoryCn }),
            on ? h('span', { class: 'ek-item__x', text: '×' }) : null
          )
        );
      }
      moreBtn.hidden = !cat.hasMore;
    }

    async function loadCatalog({ reset = false } = {}) {
      if (cat.loading) return;
      cat.loading = true;
      if (reset) {
        cat.page = 1;
        cat.items = [];
        moreBtn.hidden = true;
      }
      const params = new URLSearchParams({
        q: cat.q,
        category: cat.category,
        mode: cat.mode,
        page: String(cat.page),
        pageSize: '30',
        vegetarian: vegOnly ? '1' : '0',
        vegan: plantBased ? '1' : '0',
      });
      try {
        const res = await fetch(`/api/epicure/ingredients?${params}`);
        const data = await res.json();
        cat.stats = {
          total: data.total,
          translated: data.translated,
          analyzable: data.analyzable,
          unanalyzable: data.unanalyzable,
          categories: data.categories || [],
          lastSyncAt: data.lastSyncAt,
        };
        cat.total = data.resultTotal ?? data.total;
        cat.items = reset ? data.items || [] : [...cat.items, ...(data.items || [])];
        cat.hasMore = Boolean(data.hasMore);
        if (reset) {
          paintCatBar();
          statusLine.textContent = `Epicure 目录 ${data.total.toLocaleString('zh-CN')} 种 · 选食材后显示真实关联`;
        }
      } catch {
        if (reset) {
          cat.items = [];
          cat.total = 0;
          countLine.textContent = '食材目录加载失败，请刷新重试';
        }
      } finally {
        cat.loading = false;
        paintCounts();
        paintList();
      }
    }

    let searchTimer = 0;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        cat.q = searchInput.value.trim();
        void loadCatalog({ reset: true });
      }, 260);
    });

    moreBtn.addEventListener('click', () => {
      if (!cat.hasMore || cat.loading) return;
      cat.page += 1;
      void loadCatalog();
    });

    const catalogCard = h(
      'aside',
      { class: 'ek-card ek-catalog' },
      h('div', { class: 'ek-card__head' }, h('b', { text: '食材库' }), h('span', { class: 'ek-count', text: '' })),
      searchInput,
      tabsBar,
      catBar,
      countLine,
      listBox,
      moreBtn
    );

    /* ---------------- 模式 ---------------- */
    const modeBar = h('div', { class: 'ek-modes' });
    function paintModes() {
      clear(modeBar);
      for (const m of MODES) {
        modeBar.append(
          h(
            'button',
            {
              class: `ek-mode${mode === m.id ? ' is-on' : ''}`,
              type: 'button',
              title: m.desc,
              onclick: () => {
                mode = m.id;
                if (m.id === 'pro') advOpen = true;
                paintModes();
                paintRecipe();
              },
            },
            m.name
          )
        );
      }
    }

    /* ---------------- 配方面板 ---------------- */
    const recipeBody = h('div', { class: 'ek-recipe__body' });
    const recipeHead = h('div', { class: 'ek-card__head' });

    function paintRecipe() {
      clear(recipeHead);
      clear(recipeBody);
      const modeName = MODES.find((m) => m.id === mode)?.name || '标准';
      recipeHead.append(
        h('b', {}, modeName === '向导' ? '快速生成' : '配方设计'),
        h(
          'div',
          { class: 'ek-toggles' },
          h('label', { class: 'ek-switch' }, vegSwitch, '素食'),
          h('label', { class: 'ek-switch' }, veganSwitch, '纯素')
        )
      );

      /* 食材清单 */
      const ingRow = h('div', { class: 'ek-recipe__ings' });
      ingRow.append(h('span', { class: 'ek-label', text: `食材（${selected.length}）` }));
      const chipWrap = h('div', { class: 'ek-chips' });
      if (!selected.length) chipWrap.append(h('span', { class: 'ek-hint', text: '先在上方图谱区选食材' }));
      for (const s of selected) {
        chipWrap.append(h('button', { class: 'ek-chip', type: 'button', onclick: () => removeIngredient(s.id) }, s.cn, h('em', { text: '×' })));
      }
      ingRow.append(chipWrap);
      recipeBody.append(ingRow);

      /* 快速开始 */
      const quickHead = h(
        'div',
        { class: 'ek-recipe__row' },
        h('span', { class: 'ek-label', text: '快速开始' }),
        h(
          'button',
          {
            class: 'ek-tool',
            type: 'button',
            onclick: () => {
              quickCards = buildQuickStart();
              pickedCard = 0;
              applyCard(quickCards[0]);
              paintRecipe();
            },
          },
          '换一批'
        )
      );
      recipeBody.append(quickHead);

      for (const group of ['咸鲜', '甜润']) {
        const cards = quickCards.map((c, i) => ({ ...c, i })).filter((c) => c.group === group);
        const groupBox = h('div', { class: 'ek-quickgroup' });
        groupBox.append(h('span', { class: 'ek-quickgroup__name', text: group }));
        const grid = h('div', { class: 'ek-quickgrid' });
        for (const c of cards) {
          grid.append(
            h(
              'button',
              {
                class: `ek-quick${pickedCard === c.i ? ' is-on' : ''}`,
                type: 'button',
                onclick: () => {
                  pickedCard = c.i;
                  applyCard(c);
                  paintRecipe();
                },
              },
              h('b', { text: c.dishType }),
              h('span', { text: c.complexity })
            )
          );
        }
        groupBox.append(grid);
        recipeBody.append(groupBox);
      }

      /* 菜系语境 */
      if (mode !== 'wizard') {
        recipeBody.append(
          h(
            'div',
            { class: 'ek-recipe__row ek-recipe__row--col' },
            h('span', { class: 'ek-label', text: '菜系（可选）' }),
            h('input', {
              class: 'ek-input',
              type: 'text',
              placeholder: '如 川菜 / 江南 / 西北',
              maxlength: '20',
              value: cuisineContext,
              oninput: (e) => {
                cuisineContext = e.target.value;
                cuisineCtx.value = e.target.value;
              },
            })
          )
        );
      }

      /* 高级参数 */
      if (mode !== 'wizard') {
        const adv = h('div', { class: `ek-adv${advOpen ? ' is-open' : ''}` });
        adv.append(
          h(
            'button',
            {
              class: 'ek-adv__toggle',
              type: 'button',
              onclick: () => {
                advOpen = !advOpen;
                paintRecipe();
              },
            },
            h('em', { text: '▸' }),
            '高级配方参数'
          )
        );
        const body = h('div', { class: 'ek-adv__body' });

        const fpRow = h('div', { class: 'ek-field' }, h('span', { class: 'ek-label', text: '风味取向' }));
        const fpSeg = h('div', { class: 'ek-seg' });
        for (const f of FLAVORS) {
          fpSeg.append(
            h(
              'button',
              {
                class: `ek-seg__btn${advanced.flavorProfile === f ? ' is-on' : ''}`,
                type: 'button',
                onclick: () => {
                  advanced.flavorProfile = f;
                  paintRecipe();
                },
              },
              f
            )
          );
        }
        fpRow.append(fpSeg);
        body.append(fpRow);

        const dtRow = h('div', { class: 'ek-field' }, h('span', { class: 'ek-label', text: '菜式形态' }));
        const dtSeg = h('div', { class: 'ek-seg ek-seg--wrap' });
        for (const t of DISH_TYPES) {
          dtSeg.append(
            h(
              'button',
              {
                class: `ek-seg__btn${advanced.dishType === t ? ' is-on' : ''}`,
                type: 'button',
                onclick: () => {
                  advanced.dishType = t;
                  paintRecipe();
                },
              },
              t
            )
          );
        }
        dtRow.append(dtSeg);
        body.append(dtRow);

        const cpRow = h('div', { class: 'ek-field' }, h('span', { class: 'ek-label', text: '出品定位' }));
        const cpGrid = h('div', { class: 'ek-compgrid' });
        for (const c of COMPLEXITY) {
          cpGrid.append(
            h(
              'button',
              {
                class: `ek-comp${advanced.complexity === c.id ? ' is-on' : ''}`,
                type: 'button',
                onclick: () => {
                  advanced.complexity = c.id;
                  paintRecipe();
                },
              },
              h('b', { text: c.name }),
              h('span', { text: c.desc })
            )
          );
        }
        cpRow.append(cpGrid);
        body.append(cpRow);

        body.append(
          h(
            'div',
            { class: 'ek-field__row' },
            h(
              'div',
              { class: 'ek-field' },
              h('span', { class: 'ek-label', text: '份量（人）' }),
              h('input', {
                class: 'ek-input',
                type: 'number',
                min: '1',
                max: '12',
                value: String(advanced.servings),
                oninput: (e) => {
                  advanced.servings = Math.min(12, Math.max(1, Number(e.target.value) || 2));
                },
              })
            ),
            h(
              'div',
              { class: 'ek-field' },
              h('span', { class: 'ek-label', text: '特别要求' }),
              h('input', {
                class: 'ek-input',
                type: 'text',
                placeholder: '如：忌香菜、要辣一点、只用一口锅',
                maxlength: '60',
                value: advanced.specialRequests,
                oninput: (e) => {
                  advanced.specialRequests = e.target.value;
                },
              })
            )
          )
        );

        adv.append(body);
        recipeBody.append(adv);
      }

      recipeBody.append(
        h(
          'button',
          {
            class: 'ek-generate',
            type: 'button',
            disabled: generating,
            onclick: () => void submit(),
          },
          generating ? '正在生成…' : '生成菜谱'
        )
      );

      if (genError) recipeBody.append(h('p', { class: 'ek-error', text: genError }));
      if (generating) recipeBody.append(h('p', { class: 'ek-hint', text: '先做 Epicure 风味分析，再交给模型写菜谱，通常 30–60 秒。' }));
    }

    function applyCard(card) {
      advanced.dishType = card.dishType;
      advanced.complexity = card.complexity;
    }

    /* ---------------- 生成 ---------------- */
    async function submit() {
      if (generating) return;
      if (!selected.length) return toast('请先选择食材', 'err');
      generating = true;
      genError = '';
      paintRecipe();
      try {
        const res = await fetch('/api/epicure/create', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ingredients: selected.map((s) => ({ id: s.id, cn: s.cn, role: 'main' })),
            allowAdd: true,
            mode,
            cuisine: cuisineContext,
            dishType: advanced.dishType,
            complexity: advanced.complexity,
            flavorProfile: advanced.flavorProfile,
            servings: advanced.servings,
            specialRequests: advanced.specialRequests,
            taste: advanced.flavorProfile === '甜润' ? '甜鲜' : '咸鲜',
            style: advanced.complexity === '家常' ? 'home' : advanced.complexity === '宴席' ? 'refined' : advanced.complexity === '清简' ? 'healthy' : 'fusion',
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          genError = data.error || `请求失败（${res.status}）`;
          result = null;
          clear(resultHost);
        } else {
          result = data;
          renderResult(data);
          requestAnimationFrame(() => resultHost.scrollIntoView({ behavior: 'smooth', block: 'start' }));
        }
      } catch (err) {
        genError = `请求失败：${String(err.message || err).slice(0, 60)}`;
        result = null;
        clear(resultHost);
      } finally {
        generating = false;
        paintRecipe();
      }
    }

    const resultHost = h('div', { class: 'ek-result' });

    function renderResult(data) {
      clear(resultHost);
      const r = data.recipe;
      const a = data.analysis || {};
      const DIFF = { easy: '简单', medium: '中等', hard: '复杂' };

      const tags = h(
        'div',
        { class: 'ek-tags' },
        h('span', { class: `ek-tag ${r.dish_type === 'original' ? 'ek-tag--origin' : ''}`, text: r.dish_type === 'original' ? 'AI 原创' : '传统菜式' }),
        h('span', { class: 'ek-tag', text: r.cuisine_style }),
        h('span', { class: 'ek-tag', text: `${r.prep_minutes + r.cook_minutes} 分钟` }),
        h('span', { class: 'ek-tag', text: DIFF[r.difficulty] || r.difficulty }),
        h('span', { class: `ek-tag ${a.used ? 'ek-tag--epicure' : 'ek-tag--plain'}`, text: a.used ? 'Epicure 风味计算' : '普通 AI 生成' })
      );

      const ings = h('div', { class: 'ek-ings' });
      for (const it of r.ingredients) {
        ings.append(
          h(
            'div',
            { class: 'ek-ings__row' },
            h('span', { text: it.name }),
            h('span', { text: `${it.amount}${it.unit}` }),
            h('em', { text: it.role === 'main' ? '主料' : '辅料' })
          )
        );
      }

      const steps = h('ol', { class: 'ek-steps' });
      for (const s of r.steps) {
        steps.append(
          h(
            'li',
            {},
            h('b', { text: `${s.step}. ${s.action.slice(0, 16)}${s.action.length > 16 ? '…' : ''}` }),
            h('div', { text: s.action }),
            s.heat || s.minutes || s.note ? h('div', {}, h('i', { text: [s.heat, s.minutes ? `${s.minutes} 分钟` : '', s.note].filter(Boolean).join(' · ') })) : null
          )
        );
      }

      resultHost.append(
        h(
          'section',
          { class: 'ek-card ek-result-card' },
          h('div', { class: 'ek-result__head' }, h('h2', { class: 'ek-result__title', text: r.dish_name }), tags),
          h('p', { class: 'ek-hint', text: r.intro }),
          epicurePanel({
            recipeAnalysis: a.used
              ? {
                  used: true,
                  ingredients: a.subjects || [],
                  topPair: a.pairs?.[0] ? { a: a.pairs[0].a, b: a.pairs[0].b, score: a.pairs[0].score, label: a.pairs[0].label } : null,
                }
              : null,
          }),
          h('h3', {}, '食材'),
          ings,
          h('h3', {}, '步骤'),
          steps,
          r.creation_notes ? h('h3', {}, '创作说明') : null,
          r.creation_notes ? h('p', { class: 'ek-hint', text: r.creation_notes }) : null,
          mode === 'pro' && a.calls
            ? h('p', {
                class: 'ek-hint',
                text: `Epicure 调用 ${a.calls} 次${a.pairs?.length ? `，搭配分 ${a.pairs.map((p) => `${p.a}×${p.b} ${Number(p.score).toFixed(3)}`).join('；')}` : ''}`,
              })
            : null,
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

    /* ---------------- 分享 ---------------- */
    function openShare(recipe, data) {
      const ingText = recipe.ingredients.map((i) => `${i.name} ${i.amount}${i.unit}`).join('\n');
      const stepText = recipe.steps.map((s) => s.action).join('\n');
      const titleIn = h('input', { class: 'ek-input', type: 'text', maxlength: '24', value: recipe.dish_name });
      const introIn = h('textarea', { class: 'ek-textarea', maxlength: '160' });
      introIn.value = recipe.intro || '';
      const tasteIn = h('input', { class: 'ek-input', type: 'text', maxlength: '40', value: (recipe.flavor_profile || []).join('、') });
      const ingIn = h('textarea', { class: 'ek-textarea', maxlength: '600' });
      ingIn.value = ingText;
      const stepIn = h('textarea', { class: 'ek-textarea', maxlength: '2000' });
      stepIn.value = stepText;
      const tip = h('p', { class: 'ek-modal__tip', text: '以下内容已自动填好，都可以改；改完点「发布」才会提交到社区。' });
      const publishBtn = h('button', { class: 'btn btn--solid btn--sm', type: 'button' }, '发布');
      const cancelBtn = h('button', { class: 'btn btn--sm', type: 'button' }, '取消');

      /* 成品图：最多 3 张，逐张上传，服务端落盘后只存路径 */
      const MAX_IMAGES = 3;
      const uploaded = [];
      const fileIn = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', multiple: true, style: 'display:none' });
      const thumbs = h('div', { class: 'ek-thumbs' });
      const pickBtn = h('button', { class: 'ek-tool', type: 'button' }, '上传图片');
      const imgStatus = h('span', { class: 'ek-hint', text: `可选，最多 ${MAX_IMAGES} 张，JPG / PNG / WebP，单张 ≤3MB` });

      function paintThumbs() {
        clear(thumbs);
        uploaded.forEach((url, i) => {
          thumbs.append(
            h(
              'div',
              { class: 'ek-thumbcell' },
              h('img', { class: 'ek-thumb', src: url, alt: `成品图 ${i + 1}` }),
              h(
                'button',
                {
                  class: 'ek-thumbx',
                  type: 'button',
                  title: '移除这张',
                  onclick: () => {
                    uploaded.splice(i, 1);
                    paintThumbs();
                  },
                },
                '×'
              )
            )
          );
        });
        pickBtn.textContent = uploaded.length ? `继续添加（${uploaded.length}/${MAX_IMAGES}）` : '上传图片';
        pickBtn.disabled = uploaded.length >= MAX_IMAGES;
        imgStatus.textContent = uploaded.length
          ? `已选 ${uploaded.length} 张，发布时一并提交`
          : `可选，最多 ${MAX_IMAGES} 张，JPG / PNG / WebP，单张 ≤3MB`;
      }

      pickBtn.addEventListener('click', () => fileIn.click());

      fileIn.addEventListener('change', async () => {
        const files = [...(fileIn.files || [])];
        if (!files.length) return;
        const room = MAX_IMAGES - uploaded.length;
        if (room <= 0) {
          imgStatus.textContent = `最多 ${MAX_IMAGES} 张`;
          return;
        }
        const batch = files.slice(0, room);
        pickBtn.disabled = true;
        for (const [idx, file] of batch.entries()) {
          if (file.size > 3 * 1024 * 1024) {
            imgStatus.textContent = `第 ${idx + 1} 张超过 3MB，已跳过`;
            continue;
          }
          imgStatus.textContent = `上传中…（${idx + 1}/${batch.length}）`;
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
            if (res.status === 401) {
              imgStatus.textContent = '请先登录后再上传图片';
              break;
            }
            if (!res.ok || !out.ok) throw new Error(out.error || '上传失败');
            if (out.url) uploaded.push(out.url);
            paintThumbs();
          } catch (err) {
            imgStatus.textContent = String(err.message || err).slice(0, 30);
          }
        }
        fileIn.value = '';
        paintThumbs();
      });

      const modal = h(
        'div',
        { class: 'ek-modal', role: 'dialog', 'aria-modal': 'true' },
        h(
          'div',
          { class: 'ek-modal__box' },
          h('div', { class: 'ek-modal__head' }, h('h3', {}, '分享到美食社区'), h('button', { class: 'ek-modal__close', type: 'button', onclick: () => close() }, '×')),
          tip,
          h('div', { class: 'ek-field' }, h('span', { class: 'ek-label', text: '菜名' }), titleIn),
          h('div', { class: 'ek-field' }, h('span', { class: 'ek-label', text: '简介' }), introIn),
          h(
            'div',
            { class: 'ek-field' },
            h('span', { class: 'ek-label', text: '成品图' }),
            h('div', { class: 'ek-imgrow' }, pickBtn, fileIn, imgStatus),
            thumbs
          ),
          h('div', { class: 'ek-field' }, h('span', { class: 'ek-label', text: '口味标签' }), tasteIn),
          h('div', { class: 'ek-field' }, h('span', { class: 'ek-label', text: '食材（每行一个：名称 用量）' }), ingIn),
          h('div', { class: 'ek-field' }, h('span', { class: 'ek-label', text: '步骤（每行一步）' }), stepIn),
          h('div', { class: 'ek-modal__foot' }, cancelBtn, publishBtn)
        )
      );
      function close() {
        modal.remove();
      }
      modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
      });
      cancelBtn.addEventListener('click', close);

      publishBtn.addEventListener('click', async () => {
        const title = titleIn.value.trim();
        if (!title) return toast('菜名不能为空', 'err');
        const ingredients = ingIn.value
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map((line) => {
            const m = line.match(/^(.*?)[\s　]+([\d.]+)\s*(\D*)$/);
            return m
              ? { name: m[1].slice(0, 30), amount: Number(m[2]) || 0, unit: (m[3] || '').trim().slice(0, 6), role: 'main' }
              : { name: line.slice(0, 30), amount: 0, unit: '', role: 'main' };
          });
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
              content: `${introIn.value.trim() || title}\n\n（Epicure 厨房生成，食材与步骤见下方菜谱）`.slice(0, 800),
              kind: '菜谱分享',
              images: uploaded.slice(0, MAX_IMAGES),
              recipe: {
                title,
                intro: introIn.value.trim(),
                cuisine: recipe.cuisine_style,
                tastes: tasteIn.value.split(/[、,，\s]+/).map((t) => t.trim()).filter(Boolean).slice(0, 5),
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
          if (res.status === 401) return toast('请先登录后再分享', 'err');
          if (!res.ok) throw new Error(out.error || '发布失败');
          close();
          toast('已发布到美食社区');
          setTimeout(() => {
            location.href = '/community';
          }, 500);
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

    /* ---------------- 组装 ---------------- */
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
            h('p', { class: 'page-head__sub', text: '选食材 · 看风味关系 · 让 AI 写一道中国菜' })
          ),
          h('div', { class: 'page-head__spacer' }),
          h('a', { class: 'btn btn--sm', href: '/recipe', 'data-link': '' }, '结构化菜谱')
        ),
        h(
          'div',
          { class: 'ek-flow' },
          h('div', { class: 'ek-row' }, graphCard, catalogCard),
          modeBar,
          h('section', { class: 'ek-card ek-recipe' }, recipeHead, recipeBody),
          resultHost
        )
      )
    );

    root.append(page);
    paintModes();
    paintTabs2();
    paintChips();
    paintRecipe();

    paintTabs2();
    void loadCatalog({ reset: true });

    const onResize = () => graph.resize();
    window.addEventListener('resize', onResize);
    return {
      // 路由卸载时调用：移除监听 + 停掉漂浮动画循环
      destroy() {
        window.removeEventListener('resize', onResize);
        graph.destroy();
      },
    };
  },
};
