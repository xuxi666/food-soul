/**
 * 寻味推荐 / AI FOOD CURATION
 * ------------------------------------------------------------
 * 左页：从心情、口味、预算与更多条件出发，收集一顿饭的线索。
 * 右页：把完整需求交给当前启用的 AI，由模型独立构思菜品；不查询图鉴/菜谱候选。
 *
 * 这里刻意不维护「推荐菜谱」的假数据：
 *   · 初始状态只给可以填入左页的快捷起点，不展示虚构菜品；
 *   · 结果卡片的菜名、图片、时长、成本、标签全部来自 AI 返回并经服务端校验的数据；
 *   · AI 菜品不依赖 dishId：详情、聊天、生成菜谱都在本页完成，不要求图鉴里有记录。
 */
import { h, clear, toast } from '../lib/dom.js';
import { api, chatStream } from '../lib/api.js';
import { TASTES } from '../data/cuisines.js';
import { dishPlaceholder, guardImage } from '../lib/placeholder.js';
import { navigateToRecipeModule } from '../book/recipe-nav.js';

const MOODS = [
  { id: 'treat', label: '想犒劳自己', icon: '✦' },
  { id: 'tired', label: '疲惫想暖胃', icon: '☾' },
  { id: 'heal', label: '清淡治愈', icon: '❋' },
  { id: 'happy', label: '开心想庆祝', icon: '✧' },
  { id: 'appetite', label: '胃口不太好', icon: '◌' },
  { id: 'new', label: '想吃点新鲜', icon: '✺' },
  { id: 'indecisive', label: '选择困难', icon: '？' },
  { id: 'reward', label: '认真吃一顿', icon: '❖' },
];

const BUDGETS = [
  { id: 'under20', label: '20 元以内', short: '≤20' },
  { id: '20to50', label: '20–50 元', short: '20–50' },
  { id: '50to100', label: '50–100 元', short: '50–100' },
  { id: 'over100', label: '100 元以上', short: '100+' },
  { id: 'unlimited', label: '不限预算', short: '不限' },
];

const PEOPLE = [
  { id: '', label: '不限' },
  { id: '1', label: '1 人' },
  { id: '2', label: '2 人' },
  { id: '3-4', label: '3–4 人' },
  { id: '5+', label: '5 人以上' },
];

const SCENES = [
  { id: '', label: '不限' },
  { id: 'solo', label: '一人食' },
  { id: 'family', label: '家庭日常' },
  { id: 'friends', label: '朋友小聚' },
  { id: 'couple', label: '两个人吃' },
  { id: 'banquet', label: '请客宴席' },
  { id: 'home', label: '家常便饭' },
];

const TIMES = [
  { id: '', label: '不限' },
  { id: '15', label: '15 分钟内' },
  { id: '30', label: '30 分钟内' },
  { id: '60', label: '1 小时内' },
];

const DIFFICULTIES = [
  { id: '', label: '不限' },
  { id: 'easy', label: '简单快手' },
  { id: 'medium', label: '中等难度' },
  { id: 'hard', label: '愿意挑战' },
];

const METHODS = ['炒', '炖', '煮', '蒸', '炸', '烤', '煎', '焖', '凉拌'];

const DIETS = [
  { id: 'vegetarian', label: '素食' },
  { id: 'vegan', label: '纯素' },
  { id: 'nospicy', label: '不吃辣' },
  { id: 'lowoil', label: '少油' },
  { id: 'lowsugar', label: '少糖' },
  { id: 'lowsalt', label: '少盐' },
];

const QUICK_STARTS = [
  {
    id: 'spicy',
    kicker: '想吃点有冲击力的',
    title: '今天想吃辣',
    desc: '麻辣 / 香辣 · 适合朋友小聚',
    apply: (s) => {
      s.flavors = new Set(['mala', 'xiangla']);
      s.scene = 'friends';
    },
  },
  {
    id: 'warm',
    kicker: '累了一天',
    title: '想喝口热汤',
    desc: '疲惫暖胃 · 一小时以内',
    apply: (s) => {
      s.mood = new Set(['tired']);
      s.flavors = new Set(['qingxian', 'xianxian']);
      s.time = '60';
    },
  },
  {
    id: 'quick',
    kicker: '不想折腾',
    title: '30 分钟开饭',
    desc: '简单快手 · 一人食也行',
    apply: (s) => {
      s.time = '30';
      s.difficulty = 'easy';
      s.scene = 'solo';
    },
  },
  {
    id: 'light',
    kicker: '想吃干净一点',
    title: '清淡一点',
    desc: '清鲜本味 · 少油偏好',
    apply: (s) => {
      s.mood = new Set(['heal']);
      s.flavors = new Set(['qingxian']);
      s.diets = new Set(['lowoil']);
    },
  },
  {
    id: 'new',
    kicker: '换换口味',
    title: '没吃过的新鲜味',
    desc: '地方菜系 · 预算放宽一点',
    apply: (s) => {
      s.mood = new Set(['new']);
      s.budget = '50to100';
    },
  },
];

const TUNE_ACTIONS = [
  { id: 'mood', label: '更符合我的心情' },
  { id: 'budget', label: '预算再低一点' },
  { id: 'flavor', label: '换一种口味' },
  { id: 'simple', label: '希望做法更简单' },
  { id: 'new', label: '想吃点新鲜的' },
];

const BUDGET_BY_ID = Object.fromEntries(BUDGETS.map((b) => [b.id, b]));
const TIME_BY_ID = Object.fromEntries(TIMES.map((t) => [t.id, t]));
const DIFFICULTY_LABEL = { easy: '简单', medium: '中等', hard: '进阶' };

const unique = (list) => [...new Set(list.filter(Boolean))];
const esc = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function splitExcluded(text) {
  return unique(
    String(text || '')
      .split(/[、,，;；\n]+/)
      .map((x) => esc(x).slice(0, 12))
      .filter(Boolean)
  );
}

function itemKey(item) {
  if (!item) return '';
  if (item.aiDishId) return String(item.aiDishId);
  if (item.dishId) return String(item.dishId);
  return `ai:${esc(item.name).toLowerCase()}`;
}

function dishContext(item) {
  const ai = item?.ai || {};
  return {
    name: item?.name || ai.name || '',
    description: item?.description || ai.description || item?.intro || '',
    flavor: item?.tasteNames?.length ? item.tasteNames : item?.flavor?.length ? item.flavor : ai.flavor || [],
    ingredients: item?.ingredients?.length ? item.ingredients : ai.ingredients || [],
    cookingTime: ai.cookingTime || item?.cookingTime || '',
    estimatedCost: ai.estimatedCost || item?.estimatedCost?.label || '',
    difficulty: ai.difficulty || item?.difficultyLabel || '',
    matchReason: ai.matchReason || item?.matchReason || item?.reason || '',
    confidence: ai.confidence || item?.confidence || '',
  };
}

function makeState() {
  return {
    mood: new Set(),
    flavors: new Set(),
    budget: '',
    people: '',
    scene: '',
    time: '',
    difficulty: '',
    methods: new Set(),
    diets: new Set(),
    excludedText: '',
    freeText: '',
    refine: '',
    seen: new Set(),
    disliked: new Set(),
    dislikedNames: new Set(),
  };
}

export default {
  async mount(root) {
    const state = makeState();
    let busy = false;
    let lastData = null;
    let lastAction = 'generate';
    let loadingTimer = 0;
    let statusTimer = 0;
    let resultToken = 0;

    /* ---------------- 左页：需求表单 ---------------- */

    const moodChips = new Map();
    const flavorChips = new Map();
    const budgetChips = new Map();
    const methodChips = new Map();
    const dietChips = new Map();

    const errorLine = h('p', { class: 'rec-error-line', role: 'alert', hidden: true });
    const moreCount = h('span', { class: 'rec-more__count', hidden: true });
    const moreDetails = h('details', { class: 'rec-more' });
    const moreSummary = h(
      'summary',
      { class: 'rec-more__summary' },
      h('span', { class: 'rec-section__no', text: '04' }),
      h('span', { class: 'rec-more__title', text: '更多条件' }),
      moreCount,
      h('span', { class: 'rec-more__hint', text: '人数、场景、时长、忌口…' }),
      h('span', { class: 'rec-more__chevron', 'aria-hidden': 'true', text: '⌄' })
    );

    const peopleSelect = h(
      'select',
      { class: 'rec-select', id: 'rec-people', 'aria-label': '用餐人数' },
      ...PEOPLE.map((p) => h('option', { value: p.id }, p.label))
    );
    const sceneSelect = h(
      'select',
      { class: 'rec-select', id: 'rec-scene', 'aria-label': '用餐场景' },
      ...SCENES.map((p) => h('option', { value: p.id }, p.label))
    );
    const timeSelect = h(
      'select',
      { class: 'rec-select', id: 'rec-time', 'aria-label': '烹饪时长' },
      ...TIMES.map((p) => h('option', { value: p.id }, p.label))
    );
    const difficultySelect = h(
      'select',
      { class: 'rec-select', id: 'rec-difficulty', 'aria-label': '难度' },
      ...DIFFICULTIES.map((p) => h('option', { value: p.id }, p.label))
    );
    const excludedInput = h('input', {
      class: 'rec-input',
      type: 'text',
      maxlength: '80',
      placeholder: '如：香菜、花生、海鲜',
      'aria-label': '忌口食材',
      autocomplete: 'off',
    });
    const freeInput = h('textarea', {
      class: 'rec-textarea',
      maxlength: '300',
      rows: '3',
      placeholder: '比如：今天有点累，想吃得暖一点；家里有鸡蛋和番茄；两个人，预算 40 元左右。',
      'aria-label': '补充描述',
    });
    const freeCount = h('span', { class: 'rec-free__count', text: '0 / 300' });
    const submitBtn = h(
      'button',
      { class: 'rec-submit', type: 'submit' },
      h('span', { class: 'rec-submit__mark', 'aria-hidden': 'true', text: '✦' }),
      h('span', { class: 'rec-submit__text', text: '为我寻味' })
    );

    function chipButton({ label, icon, className = 'rec-chip', on, ariaLabel }) {
      return h(
        'button',
        {
          class: className,
          type: 'button',
          'aria-pressed': on ? 'true' : 'false',
          'aria-label': ariaLabel || label,
        },
        icon ? h('span', { class: 'rec-chip__icon', 'aria-hidden': 'true', text: icon }) : null,
        h('span', { class: 'rec-chip__text', text: label })
      );
    }

    function buildMoodGroup() {
      return h(
        'div',
        { class: 'rec-chips', role: 'group', 'aria-label': '今天的心情，可多选' },
        ...MOODS.map((mood) => {
          const chip = chipButton({ label: mood.label, icon: mood.icon });
          chip.dataset.mood = mood.id;
          chip.addEventListener('click', () => {
            toggleSet(state.mood, mood.id);
            syncForm();
          });
          moodChips.set(mood.id, chip);
          return chip;
        })
      );
    }

    function buildFlavorGroup() {
      return h(
        'div',
        { class: 'rec-chips rec-chips--taste', role: 'group', 'aria-label': '想吃的口味，可多选' },
        ...TASTES.map((taste) => {
          const chip = chipButton({ label: taste.name, className: 'rec-chip rec-chip--taste' });
          chip.dataset.flavor = taste.id;
          chip.style.setProperty('--taste-color', taste.color || '#b5452f');
          chip.addEventListener('click', () => {
            toggleSet(state.flavors, taste.id);
            syncForm();
          });
          flavorChips.set(taste.id, chip);
          return chip;
        })
      );
    }

    function buildBudgetGroup() {
      const group = h('div', {
        class: 'rec-budgets',
        role: 'radiogroup',
        'aria-label': '人均食材预算',
        'aria-orientation': 'horizontal',
      });

      const chips = BUDGETS.map((budget, index) => {
        const chip = chipButton({
          label: budget.label,
          className: 'rec-budget',
        });
        // 预算是一组受控单选，不使用多选 chips 的 aria-pressed 语义。
        chip.removeAttribute('aria-pressed');
        chip.setAttribute('role', 'radio');
        chip.setAttribute('aria-checked', 'false');
        chip.tabIndex = index === 0 ? 0 : -1;
        chip.dataset.budget = budget.id;
        chip.append(h('span', { class: 'rec-budget__mark', 'aria-hidden': 'true', text: '✓' }));
        chip.addEventListener('click', () => {
          if (busy) return;
          state.budget = budget.id;
          syncForm();
        });
        budgetChips.set(budget.id, chip);
        return chip;
      });

      group.append(...chips);
      group.addEventListener('keydown', (event) => {
        if (busy) return;
        const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
        if (!keys.includes(event.key)) return;
        const current = BUDGETS.findIndex((budget) => budget.id === event.target?.dataset?.budget);
        if (current < 0) return;
        event.preventDefault();
        let next = current;
        if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = BUDGETS.length - 1;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + BUDGETS.length) % BUDGETS.length;
        else next = (current + 1) % BUDGETS.length;
        state.budget = BUDGETS[next].id;
        syncForm();
        budgetChips.get(state.budget)?.focus();
      });

      return group;
    }

    function buildMethodChips() {
      return h(
        'div',
        { class: 'rec-chips rec-chips--small', role: 'group', 'aria-label': '偏好做法，可多选' },
        ...METHODS.map((method) => {
          const chip = chipButton({ label: method, className: 'rec-chip rec-chip--small' });
          chip.dataset.method = method;
          chip.addEventListener('click', () => {
            toggleSet(state.methods, method);
            syncForm();
          });
          methodChips.set(method, chip);
          return chip;
        })
      );
    }

    function buildDietChips() {
      return h(
        'div',
        { class: 'rec-chips rec-chips--small', role: 'group', 'aria-label': '饮食限制，可多选' },
        ...DIETS.map((diet) => {
          const chip = chipButton({ label: diet.label, className: 'rec-chip rec-chip--small' });
          chip.dataset.diet = diet.id;
          chip.addEventListener('click', () => {
            toggleSet(state.diets, diet.id);
            syncForm();
          });
          dietChips.set(diet.id, chip);
          return chip;
        })
      );
    }

    const form = h(
      'form',
      { class: 'rec-form', novalidate: '' },
      h(
        'header',
        { class: 'rec-head' },
        h(
          'div',
          { class: 'rec-head__top' },
          h(
            'span',
            { class: 'rec-kicker' },
            h('span', { class: 'rec-kicker__spark', 'aria-hidden': 'true', text: '✦' }),
            'AI FOOD CURATION'
          ),
          h('span', { class: 'rec-head__seal', 'aria-hidden': 'true' }, '寻味')
        ),
        h('h1', { class: 'rec-title', text: '寻味推荐' }),
        h(
          'p',
          { class: 'rec-subtitle' },
          '输入心情、口味和预算，让当前启用的 AI 理解你的完整需求，独立构思今天最值得尝试的几道菜。'
        )
      ),
      h(
        'section',
        { class: 'rec-section rec-section--mood' },
        h(
          'div',
          { class: 'rec-section__head' },
          h('h2', { class: 'rec-section__title' }, h('span', { class: 'rec-section__no', text: '01' }), '今天的心情'),
          h('span', { class: 'rec-section__hint', text: '可多选' }),
          h(
            'button',
            {
              class: 'rec-clear',
              type: 'button',
              onclick: () => {
                state.mood.clear();
                syncForm();
              },
            },
            '清空'
          )
        ),
        buildMoodGroup()
      ),
      h(
        'section',
        { class: 'rec-section' },
        h(
          'div',
          { class: 'rec-section__head' },
          h('h2', { class: 'rec-section__title' }, h('span', { class: 'rec-section__no', text: '02' }), '想吃的口味'),
          h('span', { class: 'rec-section__hint', text: '可多选 · 站内味型' }),
          h(
            'button',
            {
              class: 'rec-clear',
              type: 'button',
              onclick: () => {
                state.flavors.clear();
                syncForm();
              },
            },
            '清空'
          )
        ),
        buildFlavorGroup()
      ),
      h(
        'section',
        { class: 'rec-section' },
        h(
          'div',
          { class: 'rec-section__head' },
          h('h2', { class: 'rec-section__title' }, h('span', { class: 'rec-section__no', text: '03' }), '人均食材预算'),
          h('span', { class: 'rec-section__hint', text: '单选 · 人均食材估算' }),
          h(
            'button',
            {
              class: 'rec-clear',
              type: 'button',
              'aria-label': '清空预算选择',
              onclick: () => {
                if (busy) return;
                state.budget = '';
                syncForm();
              },
            },
            '清空'
          )
        ),
        buildBudgetGroup(),
        h(
          'p',
          { class: 'rec-fineprint' },
          '预算用于约束 AI 的人均食材成本估算；不是精确成本，也不代表餐厅售价。无法可靠判断时会标为“价格待确认”。'
        )
      ),
      moreDetails,
      h(
        'section',
        { class: 'rec-section rec-section--free' },
        h(
          'div',
          { class: 'rec-section__head' },
          h('h2', { class: 'rec-section__title' }, h('span', { class: 'rec-section__no', text: '05' }), '再说一句'),
          h('span', { class: 'rec-section__hint', text: '自由描述' })
        ),
        h(
          'div',
          { class: 'rec-free' },
          freeInput,
          h('div', { class: 'rec-free__foot' }, h('span', { text: '食灵会优先照顾你明确说出的需求。' }), freeCount)
        )
      ),
      errorLine,
      h(
        'div',
        { class: 'rec-submit-row' },
        submitBtn,
        h('p', { class: 'rec-submit-note' }, '✦ ', '由当前启用的 AI 根据你的完整需求独立构思；不查询图鉴或菜谱库，菜品可以不在站内收录')
      )
    );

    moreDetails.append(
      moreSummary,
      h(
        'div',
        { class: 'rec-more__body' },
        h(
          'div',
          { class: 'rec-field-grid' },
          h(
            'label',
            { class: 'rec-field' },
            h('span', { class: 'rec-field__label' }, '用餐人数'),
            peopleSelect
          ),
          h(
            'label',
            { class: 'rec-field' },
            h('span', { class: 'rec-field__label' }, '用餐场景'),
            sceneSelect
          ),
          h(
            'label',
            { class: 'rec-field' },
            h('span', { class: 'rec-field__label' }, '希望用时'),
            timeSelect
          ),
          h(
            'label',
            { class: 'rec-field' },
            h('span', { class: 'rec-field__label' }, '烹饪难度'),
            difficultySelect
          )
        ),
        h(
          'div',
          { class: 'rec-field-block' },
          h('span', { class: 'rec-field__label' }, '偏好做法'),
          buildMethodChips()
        ),
        h(
          'div',
          { class: 'rec-field-block' },
          h('span', { class: 'rec-field__label' }, '饮食限制'),
          buildDietChips()
        ),
        h(
          'label',
          { class: 'rec-field rec-field--wide' },
          h('span', { class: 'rec-field__label' }, '忌口食材'),
          excludedInput
        )
      )
    );

    const formPane = h(
      'section',
      { class: 'rec-pane rec-form-pane', 'aria-label': '寻味需求' },
      form
    );

    /* ---------------- 右页：结果 / 空状态 ---------------- */

    const resultPane = h('section', {
      class: 'rec-pane rec-result-pane',
      'aria-label': 'AI 寻味结果',
      'aria-live': 'polite',
      'aria-busy': 'false',
    });

    function initialView() {
      return h(
        'div',
        { class: 'rec-welcome' },
        h(
          'div',
          { class: 'rec-welcome__art', 'aria-hidden': 'true' },
          h('img', { src: '/bg/panorama.jpg', alt: '', loading: 'lazy' }),
          h('div', { class: 'rec-welcome__veil' }),
          h(
            'div',
            { class: 'rec-welcome__stamp' },
            h('span', { class: 'rec-welcome__stamp-cn', text: '寻味' }),
            h('span', { class: 'rec-welcome__stamp-en', text: 'CURATION' })
          )
        ),
        h(
          'div',
          { class: 'rec-welcome__copy' },
          h('p', { class: 'rec-kicker' }, h('span', { class: 'rec-kicker__spark', 'aria-hidden': 'true', text: '✦' }), '今天的这一顿'),
          h('h2', { class: 'rec-welcome__title' }, '把选择交给食灵，', h('br'), '把期待留给味蕾。'),
          h(
            'p',
            { class: 'rec-welcome__lead' },
            '不急着滑菜单。告诉我你现在的心情、想吃的味道和预算，',
            h('br'),
            '食灵会把完整需求交给当前启用的 AI，由它独立构思这一顿最合拍的几道，而不是从固定菜单里挑。'
          ),
          h(
            'div',
            { class: 'rec-quick' },
            ...QUICK_STARTS.map((quick) =>
              h(
                'button',
                {
                  class: 'rec-quick__item',
                  type: 'button',
                  onclick: () => applyQuick(quick),
                },
                h('span', { class: 'rec-quick__kicker', text: quick.kicker }),
                h('span', { class: 'rec-quick__title' }, quick.title, h('span', { class: 'rec-quick__arrow', 'aria-hidden': 'true', text: '↗' })),
                h('span', { class: 'rec-quick__desc', text: quick.desc })
              )
            )
          ),
          h(
            'p',
            { class: 'rec-welcome__note' },
            h('span', { class: 'rec-welcome__note-mark', text: '※' }),
            '推荐完全由 AI 按你的需求生成；菜可以不在图鉴或菜谱库里，也不会有固定菜单或占位菜。'
          )
        )
      );
    }

    function showInitial() {
      clear(resultPane);
      resultPane.classList.remove('is-loading', 'is-result');
      resultPane.setAttribute('aria-busy', 'false');
      resultPane.append(initialView());
    }

    showInitial();

    /* ---------------- 状态同步 ---------------- */

    function toggleSet(set, id) {
      if (busy) return;
      if (set.has(id)) set.delete(id);
      else set.add(id);
    }

    function hasCondition() {
      return Boolean(
        state.mood.size ||
          state.flavors.size ||
          Boolean(state.budget) ||
          state.people ||
          state.scene ||
          state.time ||
          state.difficulty ||
          state.methods.size ||
          state.diets.size ||
          splitExcluded(state.excludedText).length ||
          state.freeText.trim()
      );
    }

    function extraCount() {
      return (
        (state.people ? 1 : 0) +
        (state.scene ? 1 : 0) +
        (state.time ? 1 : 0) +
        (state.difficulty ? 1 : 0) +
        (state.methods.size ? 1 : 0) +
        (state.diets.size ? 1 : 0) +
        (splitExcluded(state.excludedText).length ? 1 : 0)
      );
    }

    function syncForm({ openMore = false } = {}) {
      for (const [id, chip] of moodChips) {
        const on = state.mood.has(id);
        chip.classList.toggle('is-on', on);
        chip.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      for (const [id, chip] of flavorChips) {
        const on = state.flavors.has(id);
        chip.classList.toggle('is-on', on);
        chip.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      for (const [id, chip] of budgetChips) {
        const on = state.budget === id;
        chip.classList.toggle('is-on', on);
        chip.setAttribute('aria-checked', on ? 'true' : 'false');
        // 单选组采用 roving tabindex：已选项（或未选时的第一项）可 Tab 进入，方向键切换。
        chip.tabIndex = on || (!state.budget && id === BUDGETS[0].id) ? 0 : -1;
      }
      for (const [id, chip] of methodChips) {
        const on = state.methods.has(id);
        chip.classList.toggle('is-on', on);
        chip.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      for (const [id, chip] of dietChips) {
        const on = state.diets.has(id);
        chip.classList.toggle('is-on', on);
        chip.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      peopleSelect.value = state.people;
      sceneSelect.value = state.scene;
      timeSelect.value = state.time;
      difficultySelect.value = state.difficulty;
      if (excludedInput.value !== state.excludedText) excludedInput.value = state.excludedText;
      if (freeInput.value !== state.freeText) freeInput.value = state.freeText;
      freeCount.textContent = `${state.freeText.length} / 300`;
      const count = extraCount();
      moreCount.hidden = !count;
      moreCount.textContent = String(count);
      moreDetails.classList.toggle('has-value', count > 0);
      if (openMore && count) moreDetails.open = true;
      errorLine.hidden = true;
      errorLine.textContent = '';
      syncSubmit();
      if (lastData) resultPane.classList.add('is-stale');
    }

    function syncSubmit() {
      submitBtn.disabled = busy;
      submitBtn.classList.toggle('is-busy', busy);
      submitBtn.querySelector('.rec-submit__text').textContent = busy ? '正在寻味…' : '为我寻味';
      freeInput.disabled = busy;
    }

    function showError(message) {
      errorLine.textContent = message;
      errorLine.hidden = false;
    }

    function setBusy(next) {
      busy = next;
      syncSubmit();
      resultPane.setAttribute('aria-busy', next ? 'true' : 'false');
      // 结果卡上的“换一批 / 调整方向”是在 busy=true 时创建的，结束时必须同步恢复，
      // 否则第一次结果出来后按钮会一直禁用。
      for (const btn of resultPane.querySelectorAll('.rec-refresh, .rec-tune__btn')) btn.disabled = next;
    }

    function readPayload({ batchIndex = 0, excludedDishIds = [], excludedDishNames = [] } = {}) {
      return {
        mood: [...state.mood],
        flavors: [...state.flavors],
        budget: state.budget,
        peopleCount: state.people,
        diningScenario: state.scene,
        timeLimit: state.time,
        difficulty: state.difficulty,
        cookingMethods: [...state.methods],
        dietaryRestrictions: [...state.diets],
        excludedIngredients: splitExcluded(state.excludedText),
        freeText: state.freeText.trim(),
        excludedDishIds,
        excludedDishNames,
        batchIndex,
        refine: state.refine,
      };
    }

    function applyQuick(quick) {
      if (busy) return;
      const next = makeState();
      quick.apply(next);
      state.mood = next.mood;
      state.flavors = next.flavors;
      state.budget = next.budget;
      state.people = next.people;
      state.scene = next.scene;
      state.time = next.time;
      state.difficulty = next.difficulty;
      state.methods = next.methods;
      state.diets = next.diets;
      state.excludedText = next.excludedText;
      state.freeText = next.freeText;
      state.refine = '';
      syncForm({ openMore: true });
      const face = formPane.closest('.bk-pageface');
      if (face) face.scrollTo({ top: 0, behavior: 'smooth' });
      toast('已填入一个起点，可以继续调整后点「✦ 为我寻味」');
    }

    function resetForm() {
      const next = makeState();
      state.mood = next.mood;
      state.flavors = next.flavors;
      state.budget = next.budget;
      state.people = next.people;
      state.scene = next.scene;
      state.time = next.time;
      state.difficulty = next.difficulty;
      state.methods = next.methods;
      state.diets = next.diets;
      state.excludedText = next.excludedText;
      state.freeText = next.freeText;
      state.refine = '';
      state.seen.clear();
      state.disliked.clear();
      state.dislikedNames.clear();
      syncForm();
    }

    /* ---------------- 加载状态 ---------------- */

    const LOADING_STEPS = ['整理你的完整需求', '交给当前启用的 AI 模型', '模型独立构思菜品', '核对忌口、预算与时间', '整理推荐理由'];

    function loadingCopy(step, elapsed) {
      if (elapsed < 3000) return '正在理解你的心情、口味与预算…';
      if (elapsed < 8000) return '已把完整需求交给当前 AI，正在独立构思菜品…';
      if (elapsed < 16000) return 'AI 正在权衡场景、人数、难度和忌口，不套用站内图鉴候选…';
      if (elapsed < 28000) return '正在生成每道菜的个性化推荐理由与估算信息…';
      return '正在核对过敏原、预算、时间与输出结构…';
    }

    function showLoading(action) {
      resultToken += 1;
      clearInterval(loadingTimer);
      clearInterval(statusTimer);
      const started = Date.now();
      const status = h('p', { class: 'rec-loading__status', text: loadingCopy(0, 0) });
      const stepDots = LOADING_STEPS.map((label, i) =>
        h(
          'li',
          { class: `rec-loading__step${i === 0 ? ' is-active' : ''}` },
          h('span', { class: 'rec-loading__dot', 'aria-hidden': 'true' }),
          h('span', { text: label })
        )
      );

      clear(resultPane);
      resultPane.classList.remove('is-result', 'is-stale');
      resultPane.classList.add('is-loading');
      resultPane.setAttribute('aria-busy', 'true');
      resultPane.append(
        h(
          'div',
          { class: 'rec-loading' },
          h(
            'div',
            { class: 'rec-loading__orb', 'aria-hidden': 'true' },
            h('span', { class: 'rec-loading__ring' }),
            h('span', { class: 'rec-loading__ring rec-loading__ring--2' }),
            h('span', { class: 'rec-loading__spark', text: '✦' })
          ),
          h('p', { class: 'rec-kicker rec-loading__kicker' }, action === 'refresh' ? 'RE-CURATING' : 'CURATING FOR YOU'),
          h('h2', { class: 'rec-loading__title', text: action === 'refresh' ? '换一批，重新寻味' : '正在为你寻味' }),
          status,
          h('div', { class: 'rec-loading__bar', 'aria-hidden': 'true' }, h('i')),
          h('ul', { class: 'rec-loading__steps' }, ...stepDots),
          h('p', { class: 'rec-loading__note' }, 'AI 通常需要 20–60 秒。推荐由当前模型独立构思，不读取图鉴或菜谱库；价格与时间会按估算明确标注。')
        )
      );

      statusTimer = window.setInterval(() => {
        const elapsed = Date.now() - started;
        status.textContent = loadingCopy(0, elapsed);
        const active = elapsed < 3000 ? 0 : elapsed < 8000 ? 1 : elapsed < 16000 ? 2 : elapsed < 28000 ? 3 : 4;
        stepDots.forEach((el, i) => el.classList.toggle('is-active', i === active));
      }, 900);
      loadingTimer = statusTimer;
      // 手机端只有一个翻页面：提交后必须把结果/加载面切出来，否则用户只看到被禁用的按钮。
      if (isSingle()) formPane.classList.add('is-result-view');
      resultPane.classList.add('is-result-view');
      scrollToTop(resultPane);
    }

    function stopLoading() {
      clearInterval(loadingTimer);
      clearInterval(statusTimer);
      statusTimer = 0;
      loadingTimer = 0;
    }

    /* ---------------- 结果渲染 ---------------- */

    function conditionChips(chips) {
      return h(
        'div',
        { class: 'rec-conditions' },
        ...(Array.isArray(chips) ? chips : []).map((chip) =>
          h(
            'span',
            { class: 'rec-condition' },
            h('span', { class: 'rec-condition__label', text: chip.label }),
            h('span', { class: 'rec-condition__value', text: chip.value })
          )
        )
      );
    }

    function metaLine(item) {
      const timeKnown = Number(item.timeMinutes) > 0 && item.timeStatus !== 'unconfirmed';
      const rawTime = String(item.cookingTime || '').trim();
      const timeText = timeKnown
        ? `约 ${item.timeMinutes} 分钟`
        : rawTime && !/待确认|不确定|无法/.test(rawTime)
          ? rawTime
          : '时长待确认';
      const costText =
        item.estimatedCost?.status === 'unavailable' ? '价格待确认' : item.estimatedCost?.label || '价格待确认';
      const servingsText = item.servings
        ? `${item.servings} 人份${item.servingsEstimated ? '（AI 建议）' : ''}`
        : '份量待确认';
      return h(
        'div',
        { class: 'rec-card__meta' },
        h(
          'span',
          { class: `rec-meta${timeKnown ? '' : ' rec-meta--unknown'}`, title: timeKnown ? '' : '没有可靠时长依据，不做硬填' },
          h('span', { class: 'rec-meta__icon', 'aria-hidden': 'true', text: '◷' }),
          timeText
        ),
        h('span', { class: 'rec-meta' }, h('span', { class: 'rec-meta__icon', 'aria-hidden': 'true', text: '✦' }), item.difficultyLabel || ''),
        h(
          'span',
          { class: 'rec-meta rec-meta--cost', title: item.estimatedCost?.basis || '' },
          h('span', { class: 'rec-meta__icon', 'aria-hidden': 'true', text: '¥' }),
          costText
        ),
        h('span', { class: 'rec-meta rec-meta--servings' }, servingsText)
      );
    }

    function sourceBadge(item, { compact = false } = {}) {
      return h(
        'span',
        {
          class: `rec-badge rec-badge--source rec-badge--ai-origin${compact ? ' rec-badge--source-sm' : ''}`,
          title: '由当前启用的 AI 模型根据你的条件独立构思，不来自站内图鉴或菜谱库',
        },
        h('span', { 'aria-hidden': 'true', text: '✦ ' }),
        'AI 原创'
      );
    }

    function recipeContext(item) {
      const rawTaste = item.tasteNames?.[0] || item.flavor?.[0] || '';
      const taste = TASTES.find((t) => t.name === rawTaste || rawTaste.includes(t.name) || t.name.includes(rawTaste));
      const flavors = item.tasteNames || item.flavor || [];
      const needs = (lastData?.usedConditions || []).map((chip) => `${chip.label}：${chip.value}`).join('；');
      return {
        ingredients: item.ingredients || [],
        flavors,
        taste: taste?.name || rawTaste,
        userNeeds: `${needs}${flavors.length ? `；这道菜的口味：${flavors.join('、')}` : ''}`,
        reason: item.reason || '',
        servings: item.servings || null,
        difficulty: item.difficulty || '',
      };
    }

    function actionRow(item, { compact = false } = {}) {
      const actionClass = (extra = '') => `rec-action${extra}${compact ? ' rec-action--compact' : ''}`;
      const detail = h(
        'button',
        { class: actionClass(), type: 'button', onclick: (e) => { e.stopPropagation(); openAiDishDetail(item, lastData); } },
        '查看详情'
      );
      const chat = h(
        'button',
        {
          class: actionClass(),
          type: 'button',
          onclick: (e) => {
            e.stopPropagation();
            openAiDishChat(item, lastData);
          },
        },
        '和这道菜聊聊'
      );
      const recipe = h(
        'button',
        {
          class: actionClass(' rec-action--gold'),
          type: 'button',
          onclick: (e) => {
            e.stopPropagation();
            navigateToRecipeModule({
              dishId: item.sourceType === 'ai_generated' ? undefined : item.dishId || undefined,
              dishName: item.name,
              englishName: item.nameEn,
              sourceType: item.sourceType || 'recommendation',
              sourcePage: '/recommendations',
              recipeContext: recipeContext(item),
            });
          },
        },
        '生成菜谱'
      );
      return h('div', { class: 'rec-actions' }, detail, chat, recipe);
    }

    function whyDetails(item, extraClass = '') {
      return h(
        'details',
        { class: `rec-why ${extraClass}`.trim() },
        h('summary', { class: 'rec-why__summary' }, '为什么推荐给我？', h('span', { class: 'rec-why__chevron', 'aria-hidden': 'true', text: '⌄' })),
        h(
          'ul',
          { class: 'rec-why__list' },
          ...(item.why || []).map((line) => h('li', { text: line }))
        )
      );
    }

    function dislikeButton(item, cardEl) {
      const key = itemKey(item);
      return h(
        'button',
        {
          class: 'rec-dislike',
          type: 'button',
          'aria-label': `不喜欢${item.name}`,
          onclick: async (e) => {
            e.stopPropagation();
            if (state.disliked.has(key)) return;
            const btn = e.currentTarget;
            const original = btn.textContent;
            btn.disabled = true;
            btn.textContent = '记录中…';
            try {
              await api.recommendations.feedback({
                recommendationId: lastData?.recommendationId || 'unknown',
                batchIndex: lastData?.batchIndex || 0,
                dishId: key,
                feedbackType: 'dislike',
              });
              state.disliked.add(key);
              state.dislikedNames.add(item.name);
              cardEl.classList.add('is-disliked');
              btn.textContent = '已记录，不再推荐';
              btn.classList.add('is-recorded');
              toast('已记下，换一批时不会再出现这道菜');
            } catch (err) {
              btn.disabled = false;
              btn.textContent = original;
              toast(String(err?.message || '反馈没有记上，请稍后再试'), 'warn');
            }
          },
        },
        '不喜欢这道菜'
      );
    }

    let activeOverlay = null;
    let activeChatStream = null;

    function closeActiveOverlay() {
      activeChatStream?.abort?.();
      activeChatStream = null;
      if (activeOverlay) {
        activeOverlay.cleanup?.();
        activeOverlay.overlay.remove();
        activeOverlay = null;
      }
      if (!document.querySelector('.rec-ai-overlay')) document.body.classList.remove('rec-ai-modal-open');
    }

    function createOverlay(className, label) {
      closeActiveOverlay();
      const overlay = h('div', { class: `rec-ai-overlay ${className}`.trim() });
      const panel = h('section', {
        class: 'rec-ai-panel',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': label,
      });
      overlay.append(panel);
      document.body.append(overlay);
      document.body.classList.add('rec-ai-modal-open');
      const onKey = (e) => { if (e.key === 'Escape') closeActiveOverlay(); };
      const onBackdrop = (e) => { if (e.target === overlay) closeActiveOverlay(); };
      document.addEventListener('keydown', onKey);
      overlay.addEventListener('click', onBackdrop);
      activeOverlay = {
        overlay,
        panel,
        cleanup() {
          document.removeEventListener('keydown', onKey);
          overlay.removeEventListener('click', onBackdrop);
        },
      };
      return panel;
    }

    function syncImage(item, key) {
      const src = item.image;
      if (!src) return;
      for (const img of resultPane.querySelectorAll(`img[data-rec-img="${key}"]`)) {
        if (img.getAttribute('src') !== src) img.setAttribute('src', src);
      }
      if (activeOverlay?.imageItem && itemKey(activeOverlay.imageItem) === key) {
        activeOverlay.imageEl?.setAttribute('src', src);
      }
    }

    function hydrateImages(items) {
      for (const item of items) {
        if (item.sourceType !== 'ai_generated' || item.image) continue;
        const key = itemKey(item);
        api.recommendations
          .image(item.name)
          .then((res) => {
            if (!res?.image) return;
            item.image = res.image;
            item.imageMatched = res.match || '';
            syncImage(item, key);
          })
          .catch(() => {
            /* 配图失败不影响推荐卡片，继续用按菜名生成的占位图 */
          });
      }
    }

    function detailMetric(label, value) {
      return h(
        'div',
        { class: 'rec-ai-metric' },
        h('span', { class: 'rec-ai-metric__label', text: label }),
        h('span', { class: 'rec-ai-metric__value', text: value || '待确认' })
      );
    }

    function openAiDishDetail(item, data) {
      if (!item) return;
      const key = itemKey(item);
      const panel = createOverlay('rec-ai-detail', `${item.name}详情`);
      const image = h('img', {
        class: 'rec-ai-detail__img',
        src: item.image || dishPlaceholder(item.name, '配图待补'),
        alt: item.alt || `${item.name}的配图`,
        loading: 'lazy',
        decoding: 'async',
        'data-rec-img': key,
      });
      activeOverlay.imageItem = item;
      activeOverlay.imageEl = image;
      const closeBtn = h(
        'button',
        { class: 'rec-ai-close', type: 'button', 'aria-label': '关闭详情', onclick: closeActiveOverlay },
        '×'
      );

      const ingredients = (item.ingredients || []).length
        ? h(
            'div',
            { class: 'rec-ai-detail__section' },
            h('h4', { class: 'rec-ai-detail__h', text: '主要食材' }),
            h('div', { class: 'rec-tags' }, ...item.ingredients.map((x) => h('span', { class: 'rec-tag', text: x })))
          )
        : null;
      const flavors = (item.tasteNames || item.flavor || []).length
        ? h(
            'div',
            { class: 'rec-ai-detail__section' },
            h('h4', { class: 'rec-ai-detail__h', text: '口味特点' }),
            h('div', { class: 'rec-tags' }, ...(item.tasteNames || item.flavor).map((x) => h('span', { class: 'rec-tag', text: x })))
          )
        : null;

      panel.append(
        closeBtn,
        h(
          'div',
          { class: 'rec-ai-detail__grid' },
          h('div', { class: 'rec-ai-detail__media' }, guardImage(image, item.name, '配图暂不可用')),
          h(
            'div',
            { class: 'rec-ai-detail__body' },
            h(
              'div',
              { class: 'rec-ai-detail__badges' },
              sourceBadge(item),
              h('span', { class: 'rec-badge rec-badge--ai' }, 'AI 独立构思'),
              item.confidence ? h('span', { class: 'rec-badge rec-badge--ghost', text: `置信度 ${item.confidence}` }) : null
            ),
            h('h2', { class: 'rec-ai-detail__title', text: item.name }),
            h('p', { class: 'rec-ai-detail__sub', text: 'AI 原创 · 不在图鉴中也可独立查看' }),
            h('p', { class: 'rec-ai-detail__desc', text: item.description || item.intro || '暂无简介' }),
            h(
              'blockquote',
              { class: 'rec-top__reason rec-ai-detail__reason' },
              h('span', { class: 'rec-reason-mark', 'aria-hidden': 'true', text: '“' }),
              h('span', { text: item.reason || item.matchReason || 'AI 根据你的条件做了这道推荐。' }),
              h('span', { class: 'rec-reason-mark rec-reason-mark--end', 'aria-hidden': 'true', text: '”' })
            ),
            h(
              'div',
              { class: 'rec-ai-detail__metrics' },
              detailMetric('预计耗时', item.cookingTime || (item.timeMinutes ? `约 ${item.timeMinutes} 分钟` : '时长待确认')),
              detailMetric('人均成本', item.estimatedCost?.label || '价格待确认'),
              detailMetric('制作难度', item.difficultyLabel || '待确认'),
              detailMetric('适合人数', item.servings ? `${item.servings} 人` : '按人数调整')
            ),
            flavors,
            ingredients,
            h('p', { class: 'rec-ai-detail__note', text: '价格与时间为 AI 按已有知识做的估算，不是实时市场数据；过敏原和具体配料请以下厨或点单时的实际信息为准。' }),
            h(
              'div',
              { class: 'rec-ai-detail__actions' },
              h('button', {
                class: 'rec-action rec-action--gold',
                type: 'button',
                onclick: (e) => {
                  e.stopPropagation();
                  const ctx = recipeContext(item);
                  closeActiveOverlay();
                  navigateToRecipeModule({
                    dishId: item.sourceType === 'ai_generated' ? undefined : item.dishId || undefined,
                    dishName: item.name,
                    englishName: item.nameEn,
                    sourceType: item.sourceType || 'recommendation',
                    sourcePage: '/recommendations',
                    recipeContext: ctx,
                  });
                },
              }, '生成菜谱'),
              h('button', {
                class: 'rec-action',
                type: 'button',
                onclick: (e) => {
                  e.stopPropagation();
                  openAiDishChat(item, data);
                },
              }, '和这道菜聊聊'),
              h('button', { class: 'rec-action', type: 'button', onclick: closeActiveOverlay }, '继续看推荐')
            )
          )
        )
      );
      panel.querySelector('.rec-ai-close')?.focus();
    }

    function openAiDishChat(item, data) {
      if (!item) return;
      const panel = createOverlay('rec-ai-chat-modal', `和${item.name}聊聊`);
      const messages = [];
      let streaming = false;
      let sendStream = null;
      const list = h('div', { class: 'rec-ai-chat__list', role: 'log', 'aria-live': 'polite' });
      const input = h('textarea', {
        class: 'rec-ai-chat__input',
        rows: '2',
        maxlength: '300',
        placeholder: `想问「${item.name}」什么？比如：怎么做更简单？`,
        'aria-label': '输入聊天内容',
      });
      const sendBtn = h('button', { class: 'rec-action rec-action--gold rec-ai-chat__send', type: 'submit' }, '发送');
      const stopBtn = h('button', { class: 'rec-action rec-ai-chat__stop', type: 'button', hidden: '' }, '停止');
      const form = h('form', { class: 'rec-ai-chat__form' }, input, h('div', { class: 'rec-ai-chat__form-actions' }, stopBtn, sendBtn));

      function bubble(role, text = '') {
        const node = h(
          'div',
          { class: `rec-ai-msg rec-ai-msg--${role}` },
          h('span', { class: 'rec-ai-msg__role', text: role === 'user' ? '你' : 'AI' }),
          h('p', { class: 'rec-ai-msg__text', text })
        );
        list.append(node);
        list.scrollTop = list.scrollHeight;
        return node.querySelector('.rec-ai-msg__text');
      }

      function setStreaming(next) {
        streaming = next;
        sendBtn.disabled = next;
        stopBtn.hidden = !next;
      }

      async function send(text) {
        const content = String(text || '').trim();
        if (!content || streaming) return;
        messages.push({ role: 'user', content });
        bubble('user', content);
        input.value = '';
        const textEl = bubble('assistant', '');
        let buffer = '';
        setStreaming(true);
        const controller = { abort: () => {} };
        activeChatStream = controller;
        const stream = chatStream(
          {
            mode: 'ai_dish',
            aiDish: dishContext(item),
            userNeeds: (data?.usedConditions || []).map((chip) => `${chip.label}：${chip.value}`).join('；'),
            messages,
          },
          {
            onDelta: (chunk) => {
              buffer += chunk;
              textEl.textContent = buffer;
              list.scrollTop = list.scrollHeight;
            },
            onError: (err) => {
              textEl.classList.add('is-error');
              textEl.textContent = `生成失败：${err?.message || '请稍后重试'}。`;
              if (err?.code === 'ai_not_configured' || err?.code === 'ai_disabled' || err?.code === 'ai_config_error') {
                const tip = h('p', { class: 'rec-ai-msg__hint', text: '当前没有可用的 AI 模型，请先在右上角「接入 AI」配置并启用模型。' });
                textEl.parentElement?.append(tip);
              }
            },
          }
        );
        sendStream = stream;
        controller.abort = () => stream.abort();
        if (stopBtn) stopBtn.onclick = () => stream.abort();
        await stream.done;
        if (buffer) messages.push({ role: 'assistant', content: buffer });
        setStreaming(false);
        activeChatStream = null;
        sendStream = null;
      }

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        void send(input.value);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          void send(input.value);
        }
      });

      const quick = h(
        'div',
        { class: 'rec-ai-chat__quick' },
        ...['怎么做更简单？', '可以换一种食材吗？', '适合配什么一起吃？'].map((q) =>
          h('button', { class: 'quick', type: 'button', onclick: () => void send(q) }, q)
        )
      );

      panel.append(
        h(
          'header',
          { class: 'rec-ai-chat__head' },
          h('div', {}, h('h2', { class: 'rec-ai-chat__title', text: `和「${item.name}」聊聊` }), h('p', { class: 'rec-ai-chat__sub', text: 'AI 已拿到这道推荐菜的结构化信息，可以继续问做法、替换和搭配。' })),
          h('button', { class: 'rec-ai-close', type: 'button', 'aria-label': '关闭聊天', onclick: closeActiveOverlay }, '×')
        ),
        list,
        quick,
        form
      );
      bubble('assistant', `我在。想先聊「${item.name}」的哪一部分？口味、食材替换、做法简化或搭配都可以。`);
      input.focus();
    }

    function renderTop(item, data) {
      const card = h('article', { class: 'rec-top', 'data-dish': itemKey(item) });
      const media = h(
        'div',
        {
          class: 'rec-top__media',
          role: 'button',
          tabindex: '0',
          'aria-label': `查看${item.name}详情`,
          onclick: () => openAiDishDetail(item, data),
          onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAiDishDetail(item, data); } },
        },
        guardImage(
          h('img', {
            src: item.image || dishPlaceholder(item.name, '图片待补'),
            alt: item.alt || item.name,
            loading: 'lazy',
            decoding: 'async',
            'data-rec-img': itemKey(item),
          }),
          item.name,
          '图片暂不可用'
        ),
        h('span', { class: 'rec-top__media-label', text: '本餐首选' })
      );
      const body = h(
        'div',
        { class: 'rec-top__body' },
        h(
          'div',
          { class: 'rec-top__badges' },
          h('span', { class: 'rec-badge rec-badge--ai' }, h('span', { 'aria-hidden': 'true', text: '✦ ' }), 'AI 独立构思'),
          h('span', { class: 'rec-badge', text: '最合拍' }),
          sourceBadge(item),
          h('span', { class: 'rec-badge rec-badge--ghost', text: `${data.generation?.model || 'AI'} 生成` })
        ),
        h(
          'div',
          { class: 'rec-top__head' },
          h('div', {}, h('h3', { class: 'rec-top__name', text: item.name }), h('p', { class: 'rec-top__cuisine', text: 'AI 原创 · 独立构思' })),
          h('span', { class: 'rec-top__score', text: item.tasteNames?.[0] || '今日推荐' })
        ),
        h('p', { class: 'rec-top__line', text: item.oneLiner || item.intro }),
        h(
          'blockquote',
          { class: 'rec-top__reason' },
          h('span', { class: 'rec-reason-mark', 'aria-hidden': 'true', text: '“' }),
          h('span', { text: item.reason }),
          h('span', { class: 'rec-reason-mark rec-reason-mark--end', 'aria-hidden': 'true', text: '”' })
        ),
        h(
          'div',
          { class: 'rec-tags' },
          ...(item.matchTags || []).map((tag) => h('span', { class: 'rec-tag', text: tag }))
        ),
        metaLine(item),
        h('div', { class: 'rec-top__links' }, actionRow(item)),
        whyDetails(item, 'rec-why--top'),
        h('div', { class: 'rec-top__foot' }, dislikeButton(item, card))
      );
      card.append(media, body);
      return card;
    }

    function renderSmallCard(item, index) {
      const card = h('article', { class: 'rec-card', 'data-dish': itemKey(item), style: `--rec-i:${index}` });
      const media = h(
        'div',
        {
          class: 'rec-card__media',
          role: 'button',
          tabindex: '0',
          'aria-label': `查看${item.name}详情`,
          onclick: () => openAiDishDetail(item, lastData),
          onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAiDishDetail(item, lastData); } },
        },
        guardImage(
          h('img', {
            src: item.image || dishPlaceholder(item.name, '图片待补'),
            alt: item.alt || item.name,
            loading: 'lazy',
            decoding: 'async',
            'data-rec-img': itemKey(item),
          }),
          item.name,
          '图片暂不可用'
        ),
        h(
          'span',
          { class: 'rec-card__label' },
          h('span', { 'aria-hidden': 'true', text: '✦ ' }),
          'AI 原创'
        )
      );
      const body = h(
        'div',
        { class: 'rec-card__body' },
        h(
          'div',
          { class: 'rec-card__head' },
          h('div', {}, h('h3', { class: 'rec-card__name', text: item.name }), h('p', { class: 'rec-card__cuisine', text: 'AI 原创 · 独立构思' })),
          h('span', { class: 'rec-card__no', text: String(index + 1).padStart(2, '0') })
        ),
        h('p', { class: 'rec-card__line', text: item.oneLiner || item.intro }),
        h('p', { class: 'rec-card__reason', text: item.reason }),
        h(
          'div',
          { class: 'rec-tags rec-tags--small' },
          ...(item.matchTags || []).slice(0, 3).map((tag) => h('span', { class: 'rec-tag rec-tag--small', text: tag }))
        ),
        metaLine(item),
        whyDetails(item),
        actionRow(item, { compact: true }),
        h('div', { class: 'rec-card__foot' }, dislikeButton(item, card))
      );
      card.append(media, body);
      return card;
    }

    function renderResult(data) {
      lastData = data;
      resultToken += 1;
      const items = [data.topPick, ...(data.recommendations || [])].filter(Boolean);
      for (const item of items) state.seen.add(item.name);
      const total = items.length;
      const batch = Number(data.batchIndex) || 0;

      clear(resultPane);
      resultPane.classList.remove('is-loading', 'is-stale');
      resultPane.classList.add('is-result');
      resultPane.setAttribute('aria-busy', 'false');

      const head = h(
        'header',
        { class: 'rec-result-head' },
        h(
          'div',
          { class: 'rec-result-head__copy' },
          h(
            'div',
            { class: 'rec-result-head__top' },
            h('p', { class: 'rec-kicker' }, h('span', { class: 'rec-kicker__spark', 'aria-hidden': 'true', text: '✦' }), batch > 0 ? '再寻一味' : '为你寻味'),
            h('button', { class: 'rec-mobile-back', type: 'button', onclick: backToForm }, '← 修改条件')
          ),
          h('h2', { class: 'rec-result-title', text: total === 1 ? 'AI 为你构思了这一道。' : `今天，AI 为你构思了这 ${total} 道。` }),
          h('p', { class: 'rec-result-summary', text: data.summary })
        ),
        h(
          'div',
          { class: 'rec-result-head__side' },
          h(
            'div',
            { class: 'rec-model' },
            h('span', { class: 'rec-model__dot', 'aria-hidden': 'true' }),
            h('span', { text: data.generation?.model ? `由 ${data.generation.model} 独立构思` : '由当前 AI 独立构思' })
          ),
          h(
            'button',
            {
              class: 'rec-refresh',
              type: 'button',
              disabled: busy,
              onclick: () => void generate({ mode: 'refresh' }),
            },
            h('span', { class: 'rec-refresh__icon', 'aria-hidden': 'true', text: '↻' }),
            '换一批'
          )
        )
      );

      const body = h(
        'div',
        { class: 'rec-result-body' },
        conditionChips(data.usedConditions),
        renderTop(data.topPick, data),
        (data.recommendations || []).length
          ? h(
              'section',
              { class: 'rec-more-list' },
              h(
                'div',
                { class: 'rec-more-list__head' },
                h('h3', { class: 'rec-more-list__title', text: '还可以试试' }),
                h('span', { class: 'rec-more-list__hint', text: '按与你这顿饭的贴合度排序' })
              ),
              h('div', { class: 'rec-grid' }, ...(data.recommendations || []).map((item, i) => renderSmallCard(item, i)))
            )
          : null,
        h(
          'div',
          { class: 'rec-tune' },
          h('span', { class: 'rec-tune__label' }, '调整方向'),
          ...TUNE_ACTIONS.map((action) =>
            h(
              'button',
              {
                class: 'rec-tune__btn',
                type: 'button',
                disabled: busy,
                onclick: () => void tune(action.id),
              },
              action.label
            )
          )
        ),
        h(
          'div',
          { class: 'rec-result-notes' },
          ...(data.notes || []).map((note) => h('p', { class: 'rec-result-note', text: note })),
          data.generation?.candidateCount
            ? h(
                'p',
                { class: 'rec-result-note rec-result-note--count' },
                `本轮由 AI 独立构思 ${data.generation.candidateCount} 道；${data.generation.excludedCount ? `已避开 ${data.generation.excludedCount} 道看过的菜；` : ''}没有使用图鉴或菜谱库候选。`
              )
            : null
        ),
        h(
          'div',
          { class: 'rec-result__signature' },
          h('span', { class: 'rec-result__signature-line', 'aria-hidden': 'true' }),
          h('span', { text: '食有灵 · 寻味推荐' }),
          h('span', { class: 'rec-result__signature-line', 'aria-hidden': 'true' })
        )
      );

      resultPane.append(h('div', { class: 'rec-result-inner' }, head, body));
      hydrateImages(items);
      if (isSingle()) formPane.classList.add('is-result-view');
      resultPane.classList.add('is-result-view');
      scrollToTop(resultPane);
      resultPane.querySelector('.rec-result-title')?.setAttribute('tabindex', '-1');
    }

    function renderError(err, { action = 'generate' } = {}) {
      lastAction = action;
      const code = err?.code || '';
      const data = err?.data || {};
      const isStrict = code === 'no_candidates' || code === 'ai_no_matches';
      const isExhausted = code === 'exhausted';
      const noModel = ['ai_not_configured', 'ai_disabled', 'ai_config_error', 'ai_config_unavailable'].includes(code);
      const isAI = code === 'ai_output_invalid' || code === 'ai_failed' || code === 'network' || code === 'timeout';
      const title = noModel
        ? '还没有可用的 AI 模型'
        : isStrict
          ? '这次的条件有点严格'
          : isExhausted
            ? '这一批已经看完了'
            : isAI
              ? 'AI 这次没有给出可用结果'
              : code === 'rate_limited'
                ? '先慢一点，食灵还在'
                : '推荐暂时没有端上来';
      const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];

      clear(resultPane);
      resultPane.classList.remove('is-loading', 'is-stale');
      resultPane.classList.add('is-result', 'is-error');
      resultPane.setAttribute('aria-busy', 'false');
      resultPane.append(
        h(
          'div',
          { class: 'rec-error-panel', role: 'alert' },
          h('div', { class: 'rec-error-panel__top' }, h('span', { class: 'rec-error-panel__mark', 'aria-hidden': 'true', text: '✦' }), h('button', { class: 'rec-mobile-back', type: 'button', onclick: backToForm }, '← 修改条件')),
          h('h2', { class: 'rec-error-panel__title', text: title }),
          h('p', { class: 'rec-error-panel__message', text: err?.message || '请稍后再试。' }),
          suggestions.length
            ? h(
                'ul',
                { class: 'rec-error-panel__list' },
                ...suggestions.map((s) => h('li', { text: s }))
              )
            : null,
          h(
            'div',
            { class: 'rec-error-panel__actions' },
            isStrict || isExhausted
              ? h('button', { class: 'rec-error-panel__primary', type: 'button', onclick: backToForm }, '回到条件里调整')
              : h(
                  'button',
                  {
                    class: 'rec-error-panel__primary',
                    type: 'button',
                    onclick: () => void generate({ mode: action }),
                  },
                  '再试一次'
                ),
            isExhausted
              ? h(
                  'button',
                  {
                    class: 'rec-error-panel__ghost',
                    type: 'button',
                    onclick: () => {
                      state.seen.clear();
                      state.disliked.clear();
                      state.dislikedNames.clear();
                      void generate({ mode: 'generate', resetSeen: true });
                    },
                  },
                  '从这一轮重新开始'
                )
              : h('button', { class: 'rec-error-panel__ghost', type: 'button', onclick: backToForm }, '修改条件')
          ),
          h('p', { class: 'rec-error-panel__foot', text: '你的条件还留在左页，不会丢。' })
        )
      );
      if (isSingle()) formPane.classList.add('is-result-view');
      resultPane.classList.add('is-result-view');
      scrollToTop(resultPane);
    }

    /* ---------------- 生成 / 刷新 / 调整 ---------------- */

    async function generate({ mode = 'generate', resetSeen = false } = {}) {
      if (busy) return;
      if (!hasCondition()) {
        showError('先给食灵一点线索：选一个心情、口味，或写一句你现在想吃什么。');
        formPane.closest('.bk-pageface')?.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      lastAction = mode;
      lastData = mode === 'refresh' ? lastData : null;
      if (resetSeen) state.seen.clear();
      const excludedNames = unique([...state.seen, ...state.dislikedNames]);
      const excludedIds = unique([...state.disliked]);
      const batchIndex = mode === 'refresh' ? (lastData?.batchIndex || 0) + 1 : 0;
      setBusy(true);
      syncForm();
      showLoading(mode);
      if (isSingle()) {
        formPane.classList.add('is-result-view');
        resultPane.classList.add('is-result-view');
        scrollToTop(resultPane);
      }
      try {
        const payload = readPayload({ batchIndex, excludedDishIds: excludedIds, excludedDishNames: excludedNames });
        const data =
          mode === 'refresh'
            ? await api.recommendations.refresh(payload)
            : await api.recommendations.generate(payload);
        stopLoading();
        renderResult(data);
      } catch (err) {
        stopLoading();
        renderError(err, { action: mode });
      } finally {
        setBusy(false);
        syncSubmit();
      }
    }

    async function tune(kind) {
      if (busy || !lastData) return;
      state.seen = new Set([...state.seen, ...state.dislikedNames]);
      state.refine = kind;
      if (kind === 'budget') {
        const ladder = ['unlimited', '50to100', '20to50', 'under20'];
        const at = ladder.indexOf(state.budget);
        state.budget = ladder[Math.min(ladder.length - 1, Math.max(1, at + 1))] || '20to50';
      } else if (kind === 'flavor') {
        const ids = TASTES.map((t) => t.id);
        const current = [...state.flavors];
        const start = current.length ? Math.max(...current.map((id) => ids.indexOf(id))) : -1;
        const next = ids[(start + 1 + ids.length) % ids.length];
        state.flavors = new Set([next]);
      } else if (kind === 'simple') {
        state.difficulty = 'easy';
        if (!state.time) state.time = '30';
      } else if (kind === 'new') {
        state.mood = new Set([...state.mood, 'new']);
      } else if (kind === 'mood') {
        // 不伪造心情：没有填心情时，先请用户自己定一个，再重新分析。
        if (!state.mood.size) {
          showError('先在上面选一个你现在的心情，食灵再按心情重新权衡。');
          formPane.closest('.bk-pageface')?.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
      }
      syncForm({ openMore: true });
      await generate({ mode: 'generate' });
    }

    function isSingle() {
      return Boolean(document.querySelector('.bk-stage')?.classList.contains('is-single'));
    }

    function scrollToTop(el) {
      const face = el?.closest?.('.bk-pageface');
      if (face) face.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function backToForm() {
      formPane.classList.remove('is-result-view');
      resultPane.classList.remove('is-result-view');
      const face = formPane.closest('.bk-pageface');
      if (face) face.scrollTo({ top: 0, behavior: 'smooth' });
      freeInput.focus({ preventScroll: true });
    }

    /* ---------------- 表单事件 ---------------- */

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (busy) return;
      state.refine = '';
      void generate({ mode: 'generate', resetSeen: true });
    });

    excludedInput.addEventListener('input', () => {
      state.excludedText = excludedInput.value;
      freeCount.textContent = `${state.freeText.length} / 300`;
      if (lastData) resultPane.classList.add('is-stale');
    });
    freeInput.addEventListener('input', () => {
      state.freeText = freeInput.value;
      freeCount.textContent = `${state.freeText.length} / 300`;
      if (lastData) resultPane.classList.add('is-stale');
    });
    const onSelect = (el, key) => {
      el.addEventListener('change', () => {
        state[key] = el.value;
        syncForm({ openMore: true });
      });
    };
    onSelect(peopleSelect, 'people');
    onSelect(sceneSelect, 'scene');
    onSelect(timeSelect, 'time');
    onSelect(difficultySelect, 'difficulty');

    moreDetails.addEventListener('toggle', () => {
      moreDetails.classList.toggle('is-open', moreDetails.open);
    });

    // 输入时自动长高，但不无限长
    freeInput.addEventListener('input', () => {
      freeInput.style.height = 'auto';
      freeInput.style.height = `${Math.min(150, Math.max(72, freeInput.scrollHeight))}px`;
    });

    const page = h('div', { class: 'rec-page' }, formPane, resultPane);
    root.append(page);
    syncForm();

    return {
      destroy() {
        stopLoading();
        closeActiveOverlay();
      },
    };
  },
};