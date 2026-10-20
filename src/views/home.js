import { h, clear } from '../lib/dom.js';
import { nodesFor, WHEEL_MODES } from '../data/wheel.js';
import { createGallery, hasWebGL } from '../gallery.js';
import { fluidTransition } from '../lib/transition.js';
import { mountInto, adopt } from '../router.js';

let rememberedMode = 'cuisine';
let rememberedSelect = 0;

/**
 * 首页挂载序号。
 * 同路由重新挂载时（如在首页再次点击「首页」），新实例会先挂载、旧实例后销毁；
 * 旧实例销毁时不能把新实例刚加上的 is-ready 状态清掉，否则 canvas 会停在
 * opacity:0 / scale(1.02) 的初始态，表现为轮播卡片整块消失。
 */
let homeMountSeq = 0;

/**
 * 画廊卡片数据：图片 + 上方信息区（名称 / 菜系·味型标签 / 简介 / 聊天入口）
 * 主按钮＝与该分类的菜系 AI / 口味 AI 聊天（菜品只作为当前话题）；
 * 次按钮＝进入菜系或口味页。
 */
const toItem = (n, mode) => {
  const lead = n.dishes?.[0];
  const context = lead ? `?dish=${encodeURIComponent(lead.id)}` : '';
  return {
    src: n.image || '/dishes/mapo-tofu.jpg',
    alt: n.alt,
    label: n.name,
    meta: n.meta,
    tags: n.tags || [],
    desc: n.desc,
    accent: n.accent,
    href: `/chat/${mode}/${encodeURIComponent(n.id)}${context}`,
    ctaLabel: '与它聊天',
    ctaTitle: mode === 'cuisine' ? `与${n.name} AI 聊天` : `与${n.name}口味 AI 聊天`,
    secondaryHref: n.href,
    secondaryLabel: mode === 'cuisine' ? '进入菜系' : '进入口味',
  };
};

export default {
  async mount(root) {
    const mountSeq = ++homeMountSeq;
    let mode = rememberedMode;
    let nodes = nodesFor(mode);
    let activeIndex = 0;
    let gallery = null;
    let navigating = false;

    /* ---------------- 结构 ---------------- */
    const stage = h('div', {
      class: 'stage',
      role: 'application',
      'aria-label': '美食转盘：左右拖拽旋转，点击卡片选中，按钮进入',
    });
    const canvas = h('canvas');
    const overlay = h('div', { class: 'cp-layer' });
    stage.append(canvas, overlay);

    const modeBar = h('div', { class: 'wheel-modes', role: 'tablist', 'aria-label': '展示模式' });

    const hero = h(
      'section',
      { class: 'hero wheel-hero', id: 'top' },
      h('div', { class: 'hero__bg', 'aria-hidden': 'true' }),
      stage,
      h('div', { class: 'edge edge--l', 'aria-hidden': 'true' }),
      h('div', { class: 'edge edge--r', 'aria-hidden': 'true' }),
      h('div', { class: 'grain', 'aria-hidden': 'true' }),
      h(
        'div',
        { class: 'hero__copy' },
        h('p', { class: 'hero__kicker', text: '食有灵 · FOOD SOUL' }),
        h('h1', { class: 'hero__title', text: 'A TASTE OF CHINA' }),
        h('p', { class: 'hero__sub', text: 'EIGHT CULINARY TRADITIONS. COUNTLESS PERSONALITIES.' }),
        h('p', { class: 'hero__cn', text: '探索中国美食，与每一道菜聊聊。' }),
        modeBar
      ),
      h(
        'p',
        { class: 'hint' },
        h('span', { text: 'DRAG TO EXPLORE' }),
        h('span', { class: 'hint__dot', 'aria-hidden': 'true' }),
        h('span', { text: 'CLICK TO SELECT' }),
        h('span', { class: 'hint__kbd', text: '← → 切换 · ENTER 进入 · ESC 取消' })
      ),
      h(
        'div',
        { class: 'loader', id: 'loader' },
        h('span', { class: 'loader__label', text: 'LOADING' }),
        h('span', { class: 'loader__track' }, h('i', { id: 'loaderBar' })),
        h('span', { class: 'loader__count', id: 'loaderCount', text: `00 / ${nodes.length}` })
      )
    );

    root.append(hero);

    /* ---------------- 模式切换 ---------------- */
    function renderModeBar() {
      clear(modeBar);
      WHEEL_MODES.forEach((m) => {
        modeBar.append(
          h(
            'button',
            {
              class: `wheel-modes__btn${m.id === mode ? ' is-on' : ''}`,
              type: 'button',
              role: 'tab',
              'aria-selected': String(m.id === mode),
              onclick: () => setMode(m.id),
            },
            m.label,
            h('em', { text: m.hint })
          )
        );
      });
    }

    function setActive(index) {
      if (index < 0 || index === activeIndex) return;
      activeIndex = index;
      announce();
    }

    /* ---------------- 流体穿梭转场 ---------------- */
    async function revealTo(href, kind = 'card', el = null) {
      if (navigating || !href) return false;
      navigating = true;
      try {
        return await fluidTransition({
          kind,
          el,
          accent: nodes[0]?.accent || '#d8b26a',
          render: (stageEl) => mountInto(href, stageEl),
          commit: (stageEl, instance) => adopt(stageEl, instance, href),
        });
      } finally {
        navigating = false;
      }
    }

    async function activate(node, el = stage) {
      if (!node) return;
      await revealTo(node.href, 'card', el);
    }

    /* ---------------- 画廊 ---------------- */
    const loader = hero.querySelector('#loader');
    const bar = hero.querySelector('#loaderBar');
    const countEl = hero.querySelector('#loaderCount');

    const applyOffset = () => {
      if (!gallery) return;
      // 让选中的卡片居中亮相（桌面与移动一致）
      gallery.setOffset(0);
    };

    if (hasWebGL()) {
      gallery = createGallery({
        canvas,
        stage,
        overlay,
        items: nodes.map((n) => toItem(n, mode)),
        panelMode: 'full',
        // 信息块不许压到标题/模式切换上
        panelMinTop: () => {
          const copy = hero.querySelector('.hero__copy');
          return (copy?.getBoundingClientRect().bottom || 0) + 12;
        },
        onProgress: (done, total) => {
          bar.style.width = `${Math.round((done / total) * 100)}%`;
          countEl.textContent = `${String(done).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
        },
        onSelect: (i) => {
          if (i < 0) return;
          rememberedSelect = i;
          setActive(i);
        },
        onActivate: (item, el, kind) => {
          const href = kind === 'alt' ? item.secondaryHref : item.href;
          // 「与它聊天」纵向进入；进入菜系/口味页保留景深式退场
          revealTo(href, kind === 'alt' ? 'card' : 'chat', el);
        },
        onReady: () => {
          hero.classList.add('is-ready');
          document.body.classList.add('is-ready');
          loader?.classList.add('is-hidden');
          window.setTimeout(() => loader?.remove(), 1100);
          applyOffset();
          // 返回首页时恢复上次选中的菜品
          const restored = Math.max(0, Math.min(nodes.length - 1, rememberedSelect));
          gallery?.select(restored);
          if (restored > 0) gallery?.rotateTo(restored);
          activeIndex = restored;
          announce();
        },
      });
      // 调试/验收脚本可访问画廊实例（只读观察）
      window.__exhibition = { gallery, get nodes() { return nodes; } };
    }

    if (!gallery) {
      loader?.remove();
      document.body.classList.add('is-ready');
      const fallback = h('div', { class: 'hero-fallback' });
      nodes.forEach((n) => {
        fallback.append(
          h('a', { class: 'hero-fallback__item', href: n.href, 'data-link': '' },
            h('img', { src: n.image, alt: n.alt, loading: 'lazy' }),
            h('span', { text: n.name })
          )
        );
      });
      hero.append(fallback);
    }

    /* ---------------- 模式切换实现 ---------------- */
    async function setMode(next) {
      if (next === mode) return;
      mode = next;
      rememberedMode = next;
      rememberedSelect = 0;
      renderModeBar();
      hero.classList.add('is-switching');
      nodes = nodesFor(mode);
      activeIndex = 0;
      if (gallery) {
        await gallery.setItems(nodes.map((n) => toItem(n, mode)));
        applyOffset();
        gallery.select(0);
        gallery.rotateTo(0);
      }
      renderSr();
      announce();
      window.setTimeout(() => hero.classList.remove('is-switching'), 80);
    }

    /* ---------------- 无障碍列表 ---------------- */
    const sr = h('ul', { class: 'sr-only', 'aria-label': '转盘节点' });
    const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
    function announce() {
      const node = nodes[activeIndex];
      if (node) live.textContent = `已选中：${node.name}，${node.meta}。`;
    }
    function renderSr() {
      clear(sr);
      nodes.forEach((n, i) => {
        sr.append(
          h('li', {},
            h('button', {
              type: 'button',
              onclick: () => {
                setActive(i);
                gallery?.select(i);
                gallery?.rotateTo(i);
                activate(n);
              },
              onfocus: () => setActive(i),
            }, `第 ${i + 1} 个：${n.name}，${n.meta}。进入`)
          )
        );
      });
    }
    hero.append(sr, live);

    /* ---------------- 键盘操作 ---------------- */
    stage.tabIndex = 0;
    const stepTo = (dir) => {
      const count = nodes.length;
      if (!count) return;
      const next = (activeIndex + dir + count) % count;
      setActive(next);
      gallery?.select(next);
      gallery?.rotateTo(next);
    };
    const onKey = (e) => {
      if (document.body.dataset.route !== 'home') return;
      const target = e.target;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT') return;
      if (target?.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        stepTo(-1);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        stepTo(1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        stepTo(-activeIndex);
      } else if (e.key === 'End') {
        e.preventDefault();
        stepTo(nodes.length - 1 - activeIndex);
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (target !== stage && target !== document.body) return;
        const node = nodes[activeIndex];
        if (!node) return;
        e.preventDefault();
        activate(node);
      } else if (e.key === 'Escape') {
        gallery?.select(-1);
      }
    };
    document.addEventListener('keydown', onKey);

    /* ---------------- 拖拽时弱化 ---------------- */
    const onDown = () => hero.classList.add('is-dragging');
    const onUp = () => hero.classList.remove('is-dragging');
    stage.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    const onResize = () => applyOffset();
    window.addEventListener('resize', onResize);

    renderModeBar();
    renderSr();
    announce();

    return {
      destroy() {
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        window.removeEventListener('resize', onResize);
        gallery?.destroy();
        if (window.__exhibition?.gallery === gallery) delete window.__exhibition;
        hero.classList.remove('is-ready');
        // 只有当前仍是最新实例时才移除全局就绪标记，避免误伤新挂载的首页
        if (mountSeq === homeMountSeq) document.body.classList.remove('is-ready');
      },
    };
  },
};
