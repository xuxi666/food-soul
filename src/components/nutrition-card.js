/**
 * 统一营养卡片。
 *
 * 四个入口只负责传入同一份 { dishName, ingredients, servings, sourceModule }，
 * 这里展示 loading / 结果 / 错误重试，不包含任何营养计算。
 */
import { h, clear } from '../lib/dom.js';
import {
  analyzeNutrition,
  nutritionKey,
  NUTRIENT_FIELDS,
  formatNutrient,
  dataTone,
} from '../lib/nutrition.js';

const DATA_HINT = {
  calculated: '按本地食物成分库逐项计算',
  estimated: '部分用量为估算，仅供点餐参考',
  partial: '有食材或营养项未覆盖，结果可能偏低',
  insufficient: '信息不足，暂不给出营养结论',
};

function displayValue(nutrition, view, key) {
  const src = view === 'serving' && nutrition.servings ? nutrition.perServing : nutrition.total;
  return src?.[key];
}

function loadingNode() {
  return h(
    'div',
    { class: 'nutrition-loading', role: 'status' },
    h('span', { class: 'nutrition-loading__dot', 'aria-hidden': 'true' }),
    h('span', { text: '正在分析营养成分…' }),
    h('span', { class: 'nutrition-skeleton', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))
  );
}

function errorMessage(err) {
  const raw = String(err?.message || '').trim();
  // 浏览器原生网络错误是英文；营养卡只展示中文，避免出现 "Failed to fetch"。
  if (raw && /[\u4e00-\u9fff]/.test(raw)) return raw;
  if (/abort/i.test(raw)) return '营养分析已取消，菜谱内容不受影响。';
  return '营养数据暂时无法获取，请稍后重试；菜谱内容不受影响。';
}

function errorNode(message, retry) {
  return h(
    'div',
    { class: 'nutrition-error', role: 'alert' },
    h('p', { text: message || '营养分析失败，菜谱内容不受影响。' }),
    h('button', { class: 'nutrition-retry', type: 'button', onclick: retry }, '重新分析')
  );
}

export function createNutritionCard(payload, options = {}) {
  const opts = {
    title: '营养成分',
    auto: true,
    folded: false,
    compact: false,
    summaryOnly: false,
    ...options,
  };
  let currentPayload = payload || {};
  let data = null;
  let view = 'serving';
  let seq = 0;
  let controller = null;
  let timer = 0;
  let destroyed = false;
  let loaded = false;
  let loading = false;

  const body = h('div', { class: 'nutrition-card__body' });
  const foldHint = opts.folded
    ? h('span', { class: 'nutrition-fold__hint', text: '展开查看每份估算' })
    : null;
  const el = opts.folded
    ? h(
        'details',
        { class: 'nutrition-fold' },
        h(
          'summary',
          { class: 'nutrition-fold__summary' },
          h('span', { class: 'nutrition-fold__mark', 'aria-hidden': 'true', text: '◎' }),
          h('span', { text: opts.title }),
          foldHint
        ),
        body
      )
    : h(
        'section',
        {
          class: `nutrition-card${opts.compact ? ' nutrition-card--compact' : ''}${opts.summaryOnly ? ' nutrition-card--inline' : ''}`,
          'aria-label': `${currentPayload.dishName || '菜品'}营养成分`,
        },
        opts.summaryOnly ? null : h('div', { class: 'nutrition-card__head' }, h('div', { class: 'nutrition-card__title' }, h('span', { class: 'nutrition-card__mark', 'aria-hidden': 'true', text: '◎' }), h('h4', { text: opts.title })), h('span', { class: 'nutrition-card__sub', text: '数据来自本地食物成分库' })),
        body
      );

  function setBusy(value) {
    loading = value;
    if (opts.summaryOnly) el.classList.toggle('is-loading', value);
    else el.setAttribute('aria-busy', value ? 'true' : 'false');
  }

  function paintInline(d) {
    clear(body);
    if (!d) {
      body.append(h('span', { class: 'nutrition-inline__text', text: '营养：' }), h('span', { class: 'nutrition-inline__loading', text: '分析中…' }));
      return;
    }
    const value = displayValue(d, 'serving', 'energyKcal') ?? displayValue(d, 'total', 'energyKcal');
    const serving = d.servings ? '每份' : '整道';
    body.append(
      h('span', { class: 'nutrition-inline__label', text: '营养' }),
      h('span', { class: `nutrition-inline__value${value === null ? ' is-missing' : ''}`, text: value === null ? '暂无足够数据' : `${serving}约 ${formatNutrient(value, 'energyKcal')} 千卡` }),
      h('span', { class: `nutrition-inline__tag nutrition-inline__tag--${dataTone(d.dataType)}`, text: d.dataLabel }),
      h('button', {
        class: 'nutrition-inline__more',
        type: 'button',
        onclick: (e) => {
          e.preventDefault();
          const evt = new CustomEvent('foodsoul:nutrition-open', { bubbles: true, detail: { nutrition: d } });
          el.dispatchEvent(evt);
        },
        text: '详情',
      })
    );
  }

  function paintData(d) {
    clear(body);
    const hasServings = Boolean(d.servings);
    if (!hasServings) view = 'total';
    const energy = displayValue(d, view, 'energyKcal');
    const perLabel = view === 'serving' ? '每份' : '整道';
    const status = h(
      'span',
      { class: `nutrition-badge nutrition-badge--${dataTone(d.dataType)}`, title: DATA_HINT[d.dataType] || '' },
      h('span', { class: 'nutrition-badge__dot', 'aria-hidden': 'true' }),
      d.dataLabel
    );

    const switchBtn = (id, label, disabled) =>
      h(
        'button',
        {
          class: `nutrition-switch__btn${view === id ? ' is-active' : ''}`,
          type: 'button',
          disabled: disabled ? 'disabled' : undefined,
          'aria-pressed': view === id ? 'true' : 'false',
          onclick: () => {
            if (view === id || disabled) return;
            view = id;
            paintData(d);
          },
        },
        label
      );

    body.append(
      h(
        'div',
        { class: 'nutrition-hero' },
        h(
          'div',
          { class: 'nutrition-hero__main' },
          h('p', { class: 'nutrition-hero__label', text: `${perLabel}热量` }),
          h(
            'p',
            { class: `nutrition-hero__energy${energy === null ? ' is-missing' : ''}` },
            h('strong', { text: energy === null ? '暂无数据' : formatNutrient(energy, 'energyKcal') }),
            energy === null ? null : h('span', { text: '千卡' })
          ),
          h('p', { class: 'nutrition-hero__meta', text: hasServings ? `共 ${d.servings} 人份 · ${perLabel}` : '份数未知 · 仅展示整道合计' })
        ),
        h(
          'div',
          { class: 'nutrition-hero__side' },
          status,
          h(
            'div',
            { class: 'nutrition-switch', role: 'group', 'aria-label': '查看每份或整道' },
            switchBtn('serving', '每份', !hasServings),
            switchBtn('total', '整道', false)
          )
        )
      ),
      h(
        'div',
        { class: 'nutrition-metrics' },
        ...NUTRIENT_FIELDS.map((f) => {
          const value = displayValue(d, view, f.key);
          return h(
            'div',
            { class: `nutrition-metric${value === null ? ' is-missing' : ''}` },
            h('span', { class: 'nutrition-metric__label', text: f.label }),
            h(
              'span',
              { class: 'nutrition-metric__value' },
              h('b', { text: formatNutrient(value, f.key) }),
              value === null ? null : h('i', { text: f.unit })
            )
          );
        })
      ),
      h(
        'div',
        { class: 'nutrition-foot' },
        h(
          'p',
          { class: 'nutrition-completeness' },
          h('span', { text: `完整度 ${d.completeness?.score ?? 0}%` }),
          h('span', { text: `匹配 ${d.completeness?.matchedIngredients ?? 0}/${d.completeness?.totalIngredients ?? 0} 种食材` }),
          d.completeness?.missingNutrients?.length
            ? h('span', { class: 'nutrition-completeness__warn', text: `${d.completeness.missingNutrients.length} 项暂无数据` })
            : null
        ),
        h(
          'details',
          { class: 'nutrition-details' },
          h('summary', { text: '数据说明与来源' }),
          h('p', { text: d.assumptions?.[0] || '' }),
          ...(d.assumptions || []).slice(1).map((line) => h('p', { text: line })),
          d.completeness?.missingNutrients?.length
            ? h('p', { class: 'nutrition-details__missing', text: `暂无数据：${d.completeness.missingNutrients.join('、')}` })
            : null,
          d.completeness?.missingIngredients?.length
            ? h('p', { class: 'nutrition-details__missing', text: `未匹配食材：${d.completeness.missingIngredients.join('、')}` })
            : null,
          d.sources?.[0]?.url
            ? h(
                'p',
                {},
                '数据来源：',
                h('a', { href: d.sources[0].url, target: '_blank', rel: 'noopener noreferrer', text: d.sources[0].name || '中国食物营养成分查询平台' }),
                d.sources[0].version ? `（${d.sources[0].version}）` : ''
              )
            : null
        )
      )
    );
  }

  function paintError(message) {
    clear(body);
    body.append(errorNode(message, () => load(true)));
  }

  async function load(force = false) {
    if (destroyed) return;
    if (!force && loaded && data) return;
    loaded = true;
    clearTimeout(timer);
    controller?.abort();
    controller = new AbortController();
    const mySeq = ++seq;
    setBusy(true);
    if (opts.summaryOnly) paintInline(data);
    else if (!data) {
      clear(body);
      body.append(loadingNode());
    } else {
      el.classList.add('is-refreshing');
    }
    let timedOut = false;
    timer = setTimeout(() => {
      timedOut = true;
      controller?.abort();
    }, 9000);
    try {
      const next = await analyzeNutrition(currentPayload, { signal: controller.signal });
      if (destroyed || mySeq !== seq) return;
      data = next;
      setBusy(false);
      el.classList.remove('is-refreshing');
      if (opts.summaryOnly) paintInline(data);
      else paintData(data);
    } catch (err) {
      if (destroyed || mySeq !== seq) return;
      setBusy(false);
      el.classList.remove('is-refreshing');
      if (err?.name === 'AbortError' && !timedOut) return;
      paintError(timedOut ? '营养分析超时，请重试；菜谱内容不受影响。' : errorMessage(err));
      if (opts.summaryOnly) {
        clear(body);
        body.append(h('span', { class: 'nutrition-inline__text', text: '营养：' }), h('span', { class: 'nutrition-inline__error', text: '暂时无法分析' }));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  function update(nextPayload) {
    if (!nextPayload) return;
    const before = nutritionKey(currentPayload);
    currentPayload = nextPayload;
    el.setAttribute('aria-label', `${currentPayload.dishName || '菜品'}营养成分`);
    if (nutritionKey(nextPayload) === before && data) {
      if (opts.summaryOnly) paintInline(data);
      else paintData(data);
      return;
    }
    loaded = false;
    if (opts.folded && !el.open) {
      loaded = false;
      return;
    }
    void load(true);
  }

  if (opts.folded) {
    el.addEventListener('toggle', () => {
      if (foldHint) foldHint.textContent = el.open ? '收起' : '展开查看每份估算';
      if (el.open && !loaded) void load();
    });
  }

  if (opts.auto && !opts.folded) void load();

  return {
    el,
    update,
    load,
    get data() {
      return data;
    },
    destroy() {
      destroyed = true;
      seq += 1;
      clearTimeout(timer);
      controller?.abort();
    },
  };
}