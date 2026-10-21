import { h, clear, toast } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { copyText } from '../lib/clipboard.js';
import { DISHES, DISH_BY_ID, DIFFICULTY_LABEL } from '../data/dishes.js';
import { TASTES, CUISINE_BY_ID } from '../data/cuisines.js';

const HEAT_LABEL = { low: '小火', medium: '中火', high: '大火' };

function fmtAmount(n) {
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

function buildText(recipe, factor, sources = [], dataSource = 'library') {
  const lines = [`${recipe.dish_name}（${recipe.servings} 人份）`];
  lines.push(`准备 ${recipe.prep_time_minutes} 分钟 · 烹饪 ${recipe.cook_time_minutes} 分钟 · 难度 ${DIFFICULTY_LABEL[recipe.difficulty] || recipe.difficulty}`);
  lines.push('', '【食材】');
  recipe.ingredients.forEach((i) => lines.push(`· ${i.name} ${fmtAmount(i.amount * factor)}${i.unit}${i.optional ? '（可选）' : ''}`));
  if (recipe.seasonings.length) {
    lines.push('', '【调味】');
    recipe.seasonings.forEach((i) => lines.push(`· ${i.name} ${fmtAmount(i.amount * factor)}${i.unit}`));
  }
  lines.push('', '【步骤】');
  recipe.steps.forEach((s) => {
    lines.push(`${s.step}. ${s.title}（${HEAT_LABEL[s.heat_level] || s.heat_level} · ${s.duration_minutes} 分钟）`);
    lines.push(`   ${s.description}`);
    if (s.tips) lines.push(`   要点：${s.tips}`);
  });
  if (recipe.common_mistakes.length) {
    lines.push('', '【常见失败】');
    recipe.common_mistakes.forEach((m) => lines.push(`· ${m}`));
  }
  if (recipe.safety_notes.length) {
    lines.push('', '【安全提示】');
    recipe.safety_notes.forEach((m) => lines.push(`· ${m}`));
  }
  if (sources.length) {
    lines.push('', '【资料来源】');
    sources.forEach((s, i) => {
      lines.push(`[${i + 1}] ${s.title}（${s.site || '未知站点'}）`);
      lines.push(`    ${s.url}`);
      if (s.status) lines.push(`    ${s.status}`);
    });
    lines.push('说明：菜谱由 AI 综合以上公开资料整理，未逐条核验。');
  } else if (dataSource === 'library') {
    lines.push('', '【资料来源】美食图鉴（站内数据库）');
  } else if (dataSource === 'ai-knowledge') {
    lines.push('', '【资料来源】模型已有知识生成 · 本次未完成联网核实，地方做法可能有差异，请自行核对。');
  }
  return lines.join('\n');
}

function statusPanel(text, tone = '') {
  return h('div', { class: `lookup-status${tone ? ` lookup-status--${tone}` : ''}` },
    h('span', { class: 'lookup-status__dot', 'aria-hidden': 'true' }),
    h('p', { text })
  );
}

/** 把后端返回的检索失败类型翻成一句人话（用于状态条与失败卡片标题） */
function searchIssueText(payload) {
  const kind = payload?.errorKind || '';
  if (kind === 'quota') return '联网检索额度不足';
  if (kind === 'auth') return '联网检索认证失败';
  if (kind === 'not_found') return '检索接口地址异常';
  if (kind === 'rate_limit') return '联网检索被限流';
  if (kind === 'server') return '联网检索暂时不可用';
  if (kind === 'not_configured') return '未配置联网检索';
  if (payload?.status === 'timeout') return '联网检索超时';
  if (payload?.status === 'unavailable') return '未配置联网检索';
  if (payload?.status === 'insufficient' || payload?.status === 'empty') return '未检索到可靠资料';
  return '联网检索失败';
}

/** 不可通过重试解决的检索问题，给出明确解决方向 */
function searchHint(payload) {
  const kind = payload?.errorKind || '';
  if (kind === 'quota') return '这是服务器上的联网检索服务（智谱 Web Search）额度用尽，需要管理员充值或更换 SEARCH_API_KEY。它与你「接入 AI」里填的模型（DeepSeek / OpenAI 等）额度无关，不影响模型调用。';
  if (kind === 'auth') return '服务器上的检索 Key 无效、过期或未开通 Web Search 接口权限，请管理员检查 .env 中的 SEARCH_API_KEY。这与你的模型 Key 无关。';
  if (kind === 'not_found') return '检索接口地址返回 404，请检查 SEARCH_BASE_URL 是否正确。';
  if (kind === 'not_configured') return '服务器未配置 SEARCH_API_KEY，图鉴外的菜品只能按模型已有知识生成。';
  if (kind === 'rate_limit') return '检索服务限流，稍后重试通常可以恢复。';
  return '';
}

function sourceItem(s) {
  const ok = Boolean(s.verified);
  return h(
    'article',
    { class: `source-item${ok ? '' : ' source-item--warn'}` },
    h('div', { class: 'source-item__head' },
      h('a', {
        class: 'source-item__title',
        href: s.url,
        target: '_blank',
        rel: 'noopener noreferrer',
        text: s.title || s.url,
      }),
      h('span', { class: `source-status ${ok ? 'source-status--ok' : 'source-status--warn'}`, text: s.status || (ok ? '已检索' : '未直接支持') })
    ),
    h('p', { class: 'source-item__meta', text: [s.site, s.publishDate].filter(Boolean).join(' · ') }),
    h('a', {
      class: 'source-item__url',
      href: s.url,
      target: '_blank',
      rel: 'noopener noreferrer',
      text: s.url,
    }),
    h('p', { class: 'source-item__snippet', text: s.snippet || '（该来源没有可展示的摘要）' }),
    s.supports?.length
      ? h('div', { class: 'source-item__chips' },
          h('span', { class: 'source-item__chips-label', text: '支持：' }),
          ...s.supports.map((x) => h('span', { class: 'source-chip', text: x }))
        )
      : null
  );
}

function sourcesBlock(meta) {
  const sources = Array.isArray(meta.sources) ? meta.sources : [];
  const verification = meta.verification || {};
  const note = verification.note || '菜谱由 AI 综合公开资料整理，未逐条核验。';

  if (!sources.length) {
    if (meta.dataSource === 'library') {
      return h('section', { class: 'recipe-sources' },
        h('div', { class: 'recipe-sources__head' },
          h('h3', { text: '资料来源' }),
          h('span', { class: 'source-status source-status--ok', text: '美食图鉴（站内）' })
        ),
        h('p', { class: 'recipe-sources__note', text: verification.note || '本条菜谱使用站内图鉴的菜品档案。' })
      );
    }
    return null;
  }

  const stats = meta.sourceStats || {};
  const shown = sources.length;
  const total = stats.total ?? meta.totalCount ?? shown;
  const relevant = stats.relevant ?? meta.relevantCount ?? sources.filter((s) => s.verified).length;
  const summary = total > shown
    ? `真实检索 ${total} 条 · 展示 ${shown} 条 · 直接相关 ${relevant} 条`
    : `真实检索 ${shown} 条 · 直接相关 ${relevant} 条`;

  return h(
    'section',
    { class: 'recipe-sources' },
    h('div', { class: 'recipe-sources__head' },
      h('h3', { text: '资料来源' }),
      h('span', {
        class: `source-status ${relevant ? 'source-status--ok' : 'source-status--warn'}`,
        text: summary,
      })
    ),
    h('p', { class: 'recipe-sources__note', text: note }),
    h('div', { class: 'source-list' }, ...sources.map(sourceItem))
  );
}

export default {
  async mount(root) {
    const search = new URLSearchParams(location.search);
    const presetRaw = search.get('dish') || '';

    let presetDish = DISH_BY_ID[presetRaw] || null;
    let presetName = presetDish?.name || '';
    if (!presetDish && presetRaw) {
      const byName = DISHES.find((d) => d.name === presetRaw);
      if (byName) {
        presetDish = byName;
        presetName = byName.name;
      } else if (/^[a-z0-9-]+$/i.test(presetRaw)) {
        try {
          const remote = await api.dish(presetRaw);
          if (remote?.dish) {
            presetDish = remote.dish;
            presetName = remote.dish.name;
          }
        } catch {
          presetName = presetRaw;
        }
      } else {
        presetName = presetRaw;
      }
    }
    const presetServings = Number(search.get('servings')) || 2;

    /* ---------------- 表单 ---------------- */
    const dishInput = h('input', {
      class: 'field__input',
      type: 'text',
      id: 'dishName',
      placeholder: '例如：番茄炒蛋、罗宋汤、佛跳墙',
      maxlength: '30',
      autocomplete: 'off',
      list: 'dish-name-list',
      value: presetName,
    });
    const dishList = h('datalist', { id: 'dish-name-list' }, ...DISHES.map((d) => h('option', { value: d.name })));
    const fieldHint = h('p', { class: 'field__hint', text: '可输入图鉴中没有的菜名；系统会先查图鉴，再联网检索可靠资料。' });
    const fieldError = h('p', { class: 'field__error', hidden: true });

    const servings = h('input', { class: 'field__input', type: 'number', min: '1', max: '12', value: String(presetServings) });
    const difficulty = h(
      'select',
      { class: 'field__select' },
      h('option', { value: 'easy', text: '简单' }),
      h('option', { value: 'medium', text: '中等' }),
      h('option', { value: 'hard', text: '进阶' })
    );
    const maxMinutes = h('input', { class: 'field__input', type: 'number', min: '0', max: '600', placeholder: '不限', value: '' });
    const ingredients = h('textarea', { class: 'field__area', placeholder: '冰箱里有什么？例如：豆腐、牛肉末、蒜苗', maxlength: '200' });
    const taste = h(
      'select',
      { class: 'field__select' },
      h('option', { value: '', text: '不限' }),
      ...TASTES.map((t) => h('option', { value: t.name, text: t.name }))
    );

    const submitBtn = h('button', { class: 'btn btn--solid', type: 'submit', text: '生成菜谱' });

    const form = h(
      'form',
      { class: 'tool-form' },
      h('h2', { text: '生成条件' }),
      h('label', { class: 'field' }, h('span', { text: '菜品名称' }), dishInput, dishList, fieldHint, fieldError),
      h('div', { class: 'form-row' },
        h('label', { class: 'field' }, h('span', { text: '用餐人数' }), servings),
        h('label', { class: 'field' }, h('span', { text: '难度' }), difficulty)
      ),
      h('label', { class: 'field' }, h('span', { text: '预计时间（分钟）' }), maxMinutes),
      h('label', { class: 'field' }, h('span', { text: '可用食材' }), ingredients),
      h('label', { class: 'field' }, h('span', { text: '口味偏好' }), taste),
      submitBtn,
      h('p', { class: 'tool-note', text: '图鉴菜品复用站内档案；图鉴没有的菜会真实联网检索，并在结果下方列出资料来源。' })
    );

    /* ---------------- 结果区 ---------------- */
    const result = h('div', { class: 'recipe-result' },
      h('div', { class: 'empty-state' },
        h('p', { text: '输入菜名，生成一份可以直接照着做的菜谱。' }),
        h('p', { text: '菜谱包含食材用量、分步火候、常见失败与补救建议；联网检索的菜会附资料来源。' }),
        h('p', { text: '需要先在右上角「接入 AI」配置你自己的模型；图鉴查询可正常使用。' })
      )
    );

    const page = h(
      'div',
      { class: 'page' },
      h('div', { class: 'wrap' },
        h('div', { class: 'page-head' },
          h('a', { class: 'page-head__back', href: '/', 'data-link': '' }, '← 返回'),
          h('div', {},
            h('h1', { class: 'page-head__title', text: '结构化菜谱' }),
            h('p', { class: 'page-head__sub', text: 'RECIPE GENERATOR · LIBRARY FIRST, THEN REAL WEB SEARCH' })
          ),
          h('div', { class: 'page-head__spacer' }),
          h('a', { class: 'btn btn--sm', href: '/recommend', 'data-link': '' }, '不知道做什么？')
        ),
        h('div', { class: 'tool-grid' }, form, result)
      )
    );
    root.append(page);

    let busy = false;
    let selectedDishId = '';
    let current = null;
    let factor = 1;

    function showError(message) {
      fieldError.textContent = message;
      fieldError.hidden = false;
    }
    function clearError() {
      fieldError.hidden = true;
      fieldError.textContent = '';
    }
    function syncBtn() {
      submitBtn.disabled = busy;
    }

    dishInput.addEventListener('input', () => {
      selectedDishId = '';
      clearError();
      syncBtn();
    });
    syncBtn();

    function readForm() {
      return {
        servings: Number(servings.value) || 2,
        difficulty: difficulty.value,
        ingredients: ingredients.value,
        maxMinutes: Number(maxMinutes.value) || 0,
        taste: taste.value,
      };
    }

    function renderAmbiguous(payload) {
      clear(result);
      result.append(
        h('div', { class: 'empty-state' },
          h('p', { text: payload.message || '图鉴中有多道相近的菜，请确认。' }),
          h('div', { class: 'ambiguous-list' },
            ...(payload.candidates || []).map((d) =>
              h('button', {
                class: 'btn btn--sm ambiguous-btn',
                type: 'button',
                onclick: () => {
                  selectedDishId = d.id;
                  dishInput.value = d.name;
                  clearError();
                  syncBtn();
                  form.requestSubmit();
                },
              },
                h('b', { text: d.name }),
                h('span', {
                  text: [
                    d.cuisine && CUISINE_BY_ID[d.cuisine] ? CUISINE_BY_ID[d.cuisine].name : '',
                    d.oneLiner || '',
                  ].filter(Boolean).join(' · '),
                })
              )
            )
          )
        )
      );
    }

    function renderFailure(payload) {
      const sources = Array.isArray(payload.sources) ? payload.sources : [];
      const search = payload.search || payload;
      const title = {
        insufficient: '暂未找到足够可靠的资料',
        timeout: '联网检索超时',
        failed: '联网检索失败',
        unavailable: '无法联网检索',
        empty: '没有检索到相关资料',
        invalid: '菜名无效',
      }[payload.status] || (search.errorKind === 'quota' ? '检索服务额度不足' : '暂时无法生成菜谱');
      const hint = searchHint(search);

      clear(result);
      result.append(
        h('div', { class: 'recipe-failure' },
          h('div', { class: 'empty-state' },
            h('p', { class: 'recipe-failure__title', text: title }),
            h('p', { text: payload.message || '请稍后重试，或换一个菜名。' }),
            hint ? h('p', { class: 'recipe-failure__hint', text: hint }) : null,
            h('button', { class: 'btn btn--sm', type: 'button', onclick: () => form.requestSubmit() }, '重试')
          ),
          sources.length
            ? sourcesBlock({
                sources,
                dataSource: 'ai-search',
                verification: {
                  level: 'ai-synthesized',
                  note: '以下是本次真实检索到的资料；由于资料不足，未生成菜谱。',
                },
              })
            : null
        )
      );
    }

    function renderRecipe(recipe, meta) {
      current = recipe;
      factor = 1;
      const baseServings = recipe.servings;
      const dish = meta.matchedDish || DISHES.find((d) => d.name === recipe.dish_name) || null;
      const isAi = meta.dataSource === 'ai-search';
      const isKnowledge = meta.dataSource === 'ai-knowledge';

      const servingsLabel = h('span', { text: `${baseServings} 人份` });
      const ingList = h('ul', { class: 'ing-list' });

      function paintIngredients() {
        clear(ingList);
        [...recipe.ingredients, ...recipe.seasonings].forEach((i, idx) => {
          const li = h('li', { class: 'ing' },
            h('input', { type: 'checkbox', 'aria-label': `${i.name} 已备好`, onchange: (e) => li.classList.toggle('is-done', e.target.checked) }),
            h('span', { class: 'ing__name', text: i.name }),
            h('span', { class: 'ing__amount', text: `${fmtAmount(i.amount * factor)} ${i.unit}` }),
            i.optional ? h('span', { class: 'ing__opt', text: '可选' }) : null
          );
          li.dataset.idx = String(idx);
          ingList.append(li);
        });
      }

      const steps = h('ul', { class: 'steps' });
      recipe.steps.forEach((s) => {
        const li = h('li', { class: 'step' },
          h('span', { class: 'step__no', text: String(s.step) }),
          h('div', {},
            h('div', { class: 'step__title' },
              s.title,
              h('span', { class: 'step__badges' },
                h('span', { class: 'step__badge step__badge--heat', text: HEAT_LABEL[s.heat_level] || s.heat_level }),
                h('span', { class: 'step__badge', text: `${s.duration_minutes} 分钟` })
              )
            ),
            h('p', { class: 'step__desc', text: s.description }),
            s.tips ? h('p', { class: 'step__tips', text: `要点：${s.tips}` }) : null
          )
        );
        li.addEventListener('click', (e) => {
          if (e.target.tagName === 'INPUT') return;
          li.classList.toggle('is-done');
        });
        steps.append(li);
      });

      const sourceText = {
        ai: isAi
          ? '由已接入的模型综合公开资料整理，已通过 Schema 校验；来源见上方。'
          : '由已接入的模型按美食图鉴档案生成，已通过 Schema 校验。',
      }[meta.source] || '';

      const verify = meta.verification || {};
      const card = h(
        'article',
        { class: 'recipe-card' },
        h('div', { class: 'recipe-head' },
          dish
            ? h('img', { class: 'recipe-head__thumb', src: dish.image, alt: dish.alt || dish.name })
            : h('div', { class: 'recipe-head__thumb recipe-head__thumb--ph', 'aria-hidden': 'true', text: 'AI' }),
          h('div', { class: 'recipe-head__main' },
            h('div', { class: 'recipe-head__title' },
              h('h2', { text: recipe.dish_name }),
              h('span', { class: `recipe-source-badge recipe-source-badge--${isKnowledge ? 'knowledge' : isAi ? 'ai' : 'library'}` }, isKnowledge ? '模型知识' : isAi ? 'AI 检索' : '美食图鉴')
            ),
            h('div', { class: 'recipe-meta' },
              h('span', { text: `准备 ${recipe.prep_time_minutes} 分钟` }),
              h('span', { text: `烹饪 ${recipe.cook_time_minutes} 分钟` }),
              h('span', { text: `难度 ${DIFFICULTY_LABEL[recipe.difficulty] || recipe.difficulty}` }),
              ...recipe.taste_profile.map((t) => h('span', { text: t }))
            )
          ),
          h('div', { class: 'recipe-head__actions' },
            h('button', {
              class: 'btn btn--sm',
              type: 'button',
              onclick: async () => {
                const ok = await copyText(buildText(recipe, factor, meta.sources || [], meta.dataSource));
                toast(ok ? '菜谱已复制' : '复制失败', ok ? undefined : 'err');
              },
            }, '复制菜谱'),
            h('button', { class: 'btn btn--sm', type: 'button', onclick: () => form.requestSubmit() }, '再生成一次'),
            dish ? h('a', { class: 'btn btn--sm btn--gold', href: `/chat/${dish.id}`, 'data-link': '' }, '继续问它') : null
          )
        ),
        verify.level === 'model-knowledge'
          ? h('div', { class: 'verify-banner verify-banner--warn' },
              h('b', { text: verify.label || '基于模型已有知识生成 · 未联网核实' }),
              h('p', { text: verify.note || '本次未完成联网检索，菜谱未与公开资料核对，地方做法可能有差异。' })
            )
          : verify.level === 'ai-synthesized'
            ? h('div', { class: 'verify-banner verify-banner--warn' },
                h('b', { text: verify.label || 'AI 综合整理 · 未逐条核验' }),
                h('p', { text: verify.note || '菜谱由 AI 综合公开资料整理，请对照下方来源核实。' })
              )
            : verify.level === 'library'
              ? h('div', { class: 'verify-banner verify-banner--ok' },
                  h('b', { text: verify.label || '美食图鉴（站内数据）' }),
                  h('p', { text: verify.note || '菜品档案来自站内图鉴。' })
                )
              : null,
        h('div', { class: 'recipe-cols' },
          h('div', {},
            h('div', { class: 'recipe-block' },
              h('h3', { text: '食材与调味' }),
              h('div', { class: 'servings' },
                h('button', { type: 'button', 'aria-label': '减少人数', onclick: () => change(-1) }, '−'),
                servingsLabel,
                h('button', { type: 'button', 'aria-label': '增加人数', onclick: () => change(1) }, '+')
              ),
              ingList
            ),
            recipe.substitutions.length
              ? h('div', { class: 'recipe-block' },
                  h('h3', { text: '替代方案' }),
                  h('ul', { class: 'list-note' }, ...recipe.substitutions.map((s) => h('li', { text: s })))
                )
              : null
          ),
          h('div', {},
            h('div', { class: 'recipe-block' },
              h('h3', { text: '制作步骤' }),
              steps
            ),
            recipe.common_mistakes.length
              ? h('div', { class: 'recipe-block' },
                  h('h3', { text: '常见失败与补救' }),
                  h('ul', { class: 'list-note' }, ...recipe.common_mistakes.map((s) => h('li', { text: s })))
                )
              : null,
            recipe.safety_notes.length
              ? h('div', { class: 'recipe-block' },
                  h('h3', { text: '安全提示' }),
                  h('ul', { class: 'list-note' }, ...recipe.safety_notes.map((s) => h('li', { text: s })))
                )
              : null
          )
        ),
        sourcesBlock(meta),
        h('p', { class: 'source-note', text: sourceText })
      );

      function change(delta) {
        const next = Math.min(12, Math.max(1, recipe.servings + delta));
        if (next === recipe.servings) return;
        recipe.servings = next;
        factor = next / baseServings;
        servingsLabel.textContent = `${next} 人份`;
        paintIngredients();
      }

      paintIngredients();
      clear(result);
      result.append(card);
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = dishInput.value.trim();
      if (!name) {
        showError('请先输入菜品名称');
        dishInput.focus();
        toast('请先输入菜品名称', 'err');
        return;
      }
      if (busy) return;
      clearError();
      busy = true;
      submitBtn.disabled = true;
      submitBtn.textContent = '查询中…';
      clear(result);
      result.append(statusPanel('正在查询美食图鉴…'));

      try {
        const lookup = await api.recipeLookup({ dishName: name, ...(selectedDishId ? { dishId: selectedDishId } : {}) });

        if (lookup.status === 'ambiguous') {
          renderAmbiguous(lookup);
          return;
        }
        if (lookup.status === 'invalid') {
          renderFailure(lookup);
          return;
        }
        if (lookup.status !== 'ok') {
          // 图鉴未命中且检索不可用（配额/鉴权/超时/无可靠结果）：
          // 不中断流程，交给后端按模型已有知识生成，并在结果里标明未联网核实。
          const reason = searchIssueText(lookup);
          const scope = lookup.errorKind === 'quota' || lookup.errorKind === 'auth' ? '（与你的 AI 模型无关）' : '';
          clear(result);
          result.append(statusPanel(`${reason}${scope}，正在按模型已有知识生成菜谱…`, 'warn'));
          const res = await api.recipe({ dishName: name, ...readForm() });
          if (!res.recipe) {
            renderFailure({ ...res, search: res.search || lookup });
            return;
          }
          renderRecipe(res.recipe, res);
          return;
        }

        const base = readForm();
        if (lookup.dataSource === 'library') {
          clear(result);
          result.append(statusPanel(`图鉴已找到「${lookup.dish.name}」，正在生成菜谱…`));
          const res = await api.recipe({ dishName: lookup.dish.name, dishId: lookup.dish.id, ...base });
          if (!res.recipe) {
            renderFailure(res);
            return;
          }
          renderRecipe(res.recipe, { ...res, matchedDish: lookup.dish, dataSource: 'library' });
        } else {
          const count = lookup.relevantCount || lookup.sources?.length || 0;
          clear(result);
          result.append(statusPanel(`图鉴暂无记录，已检索到 ${count} 条资料，正在整理菜谱…`));
          const res = await api.recipe({ dishName: name, lookupId: lookup.lookupId, ...base });
          if (!res.recipe) {
            renderFailure(res);
            return;
          }
          renderRecipe(res.recipe, { ...res, dataSource: 'ai-search', sources: res.sources || lookup.sources || [] });
        }
      } catch (err) {
        renderFailure({ status: 'failed', message: `生成失败：${err.message}`, sources: [] });
      } finally {
        busy = false;
        submitBtn.textContent = '生成菜谱';
        syncBtn();
      }
    });

    // 带参数进入时自动生成
    if (presetName) form.requestSubmit();

    return { destroy() {} };
  },
};
