import { h, clear, toast } from '../lib/dom.js';
import { createNutritionCard } from '../components/nutrition-card.js';
import { epicurePanel } from '../components/epicure-panel.js';
import { api } from '../lib/api.js';
import { copyText } from '../lib/clipboard.js';
import { DISHES, DISH_BY_ID, DIFFICULTY_LABEL } from '../data/dishes.js';
import { RECIPE_NAV_EVENT, consumeRecipeNav } from '../book/recipe-nav.js';
import { TASTES, CUISINE_BY_ID } from '../data/cuisines.js';

const HEAT_LABEL = { low: '小火', medium: '中火', high: '大火' };

/** 有的模型会在 tips 前面带上「AI 建议：」，这里剥掉前缀只留内容 */
function tipText(t) {
  return String(t || '')
    .replace(/^(ai\s*建议|ai\s*提示|ai\s*recommendation|建议|提示)\s*[：:]\s*/i, '')
    .trim();
}
/** 模型偶尔把 tips 填成「AI 建议」这类占位词：这种不显示，免得每步都挂一句废话 */
function usableTip(t) {
  const v = String(t || '').trim();
  if (!v) return '';
  if (/^(ai\s*建议|ai\s*提示|ai\s*recommendation|建议|提示|无|暂无|-|—|－)$/i.test(v)) return '';
  return v;
}

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

/* ---------------- 资料来源（默认折叠：3 条主要来源 + 展开全部） ---------------- */
/** 检索接口给的日期五花八门（"周日，01 11月 2026 14:12:00" / "2026年11月1日" / ISO），统一成 YYYY-MM-DD */
function pad2(n) {
  return String(n).padStart(2, '0');
}
function prettyDate(raw) {
  const t = String(raw || '').trim();
  if (!t) return '';
  const iso = t.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
  if (iso) return iso[1] + '-' + pad2(iso[2]) + '-' + pad2(iso[3]);
  const year = t.match(/(20\d{2})/);
  const month = t.match(/(\d{1,2})\s*月/);
  const day = t.match(/(\d{1,2})\s*日/) || (month ? t.slice(0, month.index).match(/(\d{1,2})\s*$/) : null);
  if (year && month && day) return year[1] + '-' + pad2(month[1]) + '-' + pad2(day[1]);
  return t;
}

/** 一条来源的副信息：真实站点（域名）+ 发布日期（有才显示） */
function sourceMetaLine(s) {
  const site = s.host || s.site || '';
  return [site, prettyDate(s.publishDate)].filter(Boolean).join(' · ');
}

/** 收起态：一条来源只占一行，只留标题 + 站点/日期 */
function compactSourceRow(s, i) {
  const href = s.url || '';
  const title = s.title || s.host || href || '未命名来源';
  const meta = sourceMetaLine(s);
  return h(
    'li',
    { class: 'rc-src' },
    h('span', { class: 'rc-src__no', text: String(i + 1) }),
    href
      ? h('a', { class: 'rc-src__title', href, target: '_blank', rel: 'noopener noreferrer', title, text: title })
      : h('span', { class: 'rc-src__title', title, text: title }),
    meta ? h('span', { class: 'rc-src__meta', text: meta }) : null
  );
}

/** 展开态：完整来源记录。原始 URL 不再单独铺一行，标题本身就是可点击的原始链接 */
function sourceDetail(s) {
  const ok = Boolean(s.verified);
  const href = s.url || '';
  const title = s.title || s.host || href || '未命名来源';
  return h(
    'article',
    { class: 'source-item' },
    h('div', { class: 'source-item__head' },
      href
        ? h('a', { class: 'source-item__title', href, target: '_blank', rel: 'noopener noreferrer', text: title })
        : h('span', { class: 'source-item__title', text: title }),
      h('span', {
        class: `source-status ${ok ? 'source-status--ok' : 'source-status--warn'}`,
        text: s.status || (ok ? '已检索' : '未直接支持'),
      })
    ),
    h('p', { class: 'source-item__meta', text: sourceMetaLine(s) }),
    s.snippet ? h('p', { class: 'source-item__snippet', text: s.snippet }) : null,
    s.supports?.length
      ? h('div', { class: 'source-item__chips' },
          h('span', { class: 'source-item__chips-label', text: '关键词匹配：' }),
          ...s.supports.map((x) => h('span', { class: 'source-chip', text: x }))
        )
      : null
  );
}

function sourcesBlock(meta) {
  const sources = Array.isArray(meta.sources) ? meta.sources : [];
  const verification = meta.verification || {};

  if (!sources.length) {
    if (meta.dataSource !== 'library') return null;
    return h('section', { class: 'recipe-sources' },
      h('div', { class: 'recipe-sources__head' },
        h('h3', { text: '资料来源' }, h('span', { class: 'rc-sources__stat', text: '美食图鉴（站内档案）' }))
      ),
      h('p', { class: 'rc-sources__note', text: verification.note || '本条菜谱使用站内图鉴的菜品档案。' })
    );
  }

  const stats = meta.sourceStats || {};
  const total = stats.total ?? meta.totalCount ?? sources.length;
  const relevant = stats.relevant ?? meta.relevantCount ?? sources.filter((s) => s.verified).length;
  const primary = sources.slice(0, 3);

  const full = h('div', { class: 'rc-sources__full', hidden: true },
    h('p', { class: 'rc-sources__note', text: `以下 ${sources.length} 条为本次真实检索到的公开资料，点击标题可打开原始网页。` }),
    h('div', { class: 'source-list' }, ...sources.map(sourceDetail))
  );

  const label = h('span', { class: 'rc-sources__toggle-label', text: `已展示 ${primary.length} 条主要来源` });
  const cta = h('span', { class: 'rc-sources__toggle-cta', text: `展开全部 ${sources.length} 条` });
  const toggle = h('button', { class: 'rc-sources__toggle', type: 'button', 'aria-expanded': 'false' }, label, cta);

  const section = h('section', { class: 'recipe-sources' },
    h('div', { class: 'recipe-sources__head' },
      h('h3', { text: '资料来源' },
        h('span', { class: 'rc-sources__stat', text: `真实检索 ${total} 条${relevant ? ` · 直接相关 ${relevant} 条` : ''}` })
      ),
      toggle
    ),
    h('ul', { class: 'rc-sources__list' }, ...primary.map(compactSourceRow)),
    full
  );

  toggle.addEventListener('click', () => {
    const open = full.hidden;
    full.hidden = !open;
    section.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    label.textContent = open ? `全部 ${sources.length} 条来源` : `已展示 ${primary.length} 条主要来源`;
    cta.textContent = open ? '收起' : `展开全部 ${sources.length} 条`;
  });

  return section;
}

/* 结果卡片左上角的缩略图：图鉴菜品用站内图，未收录菜品用检索到的真实图，都没有则显示菜名占位 */
function thumbPlaceholder(name) {
  const label = String(name || '').trim().slice(0, 3) || '菜谱';
  return h('div', { class: 'recipe-head__thumb recipe-head__thumb--ph', 'aria-hidden': 'true', text: label });
}

function thumbFor(dish, dishName, image) {
  if (dish && dish.image) {
    return h('img', { class: 'recipe-head__thumb', src: dish.image, alt: dish.alt || dish.name, loading: 'lazy' });
  }
  if (image && image.url) {
    const img = h('img', {
      class: 'recipe-head__thumb',
      src: image.url,
      alt: `${dishName} 的成品图`,
      loading: 'lazy',
      title: image.source ? `图片来源：${image.source}` : '',
    });
    // 链接失效时不显示破图，直接换成菜名占位
    img.addEventListener('error', () => img.replaceWith(thumbPlaceholder(dishName)), { once: true });
    return img;
  }
  return thumbPlaceholder(dishName);
}

export default {
  async mount(root) {
    const search = new URLSearchParams(location.search);
    const presetRaw = search.get('dish') || '';
    // 详情页会同时传 name，用于精确回填输入框（URLSearchParams 已自动解码，中文/空格/特殊字符都安全）
    const presetNameParam = (search.get('name') || '').trim().slice(0, 30);
    const presetIngredientsParam = (search.get('ingredients') || '').trim().slice(0, 200);
    const presetTasteParam = (search.get('taste') || '').trim().slice(0, 20);
    const presetNotesParam = (search.get('notes') || '').trim().slice(0, 600);

    let presetDish = DISH_BY_ID[presetRaw] || null;
    let presetName = presetNameParam || presetDish?.name || '';
    if (!presetDish && presetRaw && !presetNameParam) {
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
    if (presetName) dishInput.value = presetName;
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
    const ingredients = h('textarea', {
      class: 'field__area',
      placeholder: '冰箱里有什么？例如：豆腐、牛肉末、蒜苗',
      maxlength: '200',
      value: presetIngredientsParam,
    });
    if (presetIngredientsParam) ingredients.value = presetIngredientsParam;
    const taste = h(
      'select',
      { class: 'field__select' },
      h('option', { value: '', text: '不限' }),
      ...TASTES.map((t) => h('option', { value: t.name, text: t.name }))
    );
    if (presetTasteParam) {
      const presetTaste = TASTES.find((t) => t.name === presetTasteParam || presetTasteParam.includes(t.name) || t.name.includes(presetTasteParam));
      if (presetTaste) taste.value = presetTaste.name;
    }
    const notes = h('textarea', {
      class: 'field__area',
      placeholder: '例如：做给两个人吃、想少油、希望 30 分钟内完成',
      maxlength: '600',
      value: presetNotesParam,
    });
    if (presetNotesParam) notes.value = presetNotesParam;

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
      h('label', { class: 'field' }, h('span', { text: '补充要求（可选）' }), notes),
      submitBtn,
      h('p', { class: 'tool-note', text: '图鉴菜品复用站内档案；图鉴没有的菜会真实联网检索，并在结果下方列出资料来源。' })
    );

    /* ---------------- 结果区 ---------------- */
    // 结果还没生成时，右页不留白：列出一批图鉴里真实存在的菜，点一下就能带着名字开写
    const starterPicks = h(
      'div',
      { class: 'recipe-starters' },
      h('p', { class: 'recipe-starters__title', text: '从图鉴里挑一道开始' }),
      h(
        'div',
        { class: 'recipe-starters__list' },
        ...DISHES.slice(0, 16).map((d) =>
          h(
            'button',
            {
              class: 'recipe-starter',
              type: 'button',
              'data-dish': d.id,
              onclick: () => {
                dishInput.value = d.name;
                dishInput.focus();
              },
            },
            h('b', { text: d.name }),
            h('span', { text: `${CUISINE_BY_ID[d.cuisine]?.name || ''} · ${(d.tastes || []).length} 种味型` })
          )
        )
      )
    );

    const result = h('div', { class: 'recipe-result' },
      h('div', { class: 'empty-state' },
        h('p', { text: '输入菜名，生成一份可以直接照着做的菜谱。' }),
        h('p', { text: '菜谱包含食材用量、分步火候、常见失败与补救建议；联网检索的菜会附资料来源。' }),
        h('p', { text: '由当前启用的 AI 生成；如果想使用自己的模型，可在右上角「接入 AI」配置。图鉴查询可正常使用。' }),
        starterPicks
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
          h('a', { class: 'btn btn--sm', href: '/kitchen', 'data-link': '' }, '不知道做什么？')
        ),
        h('div', { class: 'tool-grid' }, form, result)
      )
    );
    root.append(page);

    let busy = false;
    let selectedDishId = '';
    let current = null;
    let factor = 1;
    let activeNutrition = null;

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
        notes: notes.value.trim(),
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
      activeNutrition?.destroy();
      activeNutrition = null;
      current = recipe;
      factor = 1;
      const baseServings = recipe.servings;
      const dish = meta.matchedDish || DISHES.find((d) => d.name === recipe.dish_name) || null;
      const isAi = meta.dataSource === 'ai-search';
      const isKnowledge = meta.dataSource === 'ai-knowledge';

      const servingsLabel = h('span', { text: `${baseServings} 人份` });
      const ingList = h('ul', { class: 'ing-list' });

      function nutritionPayload() {
        const rows = [
          ...recipe.ingredients.map((i) => ({ i, role: 'main' })),
          ...recipe.seasonings.map((i) => ({ i, role: 'aux' })),
        ];
        return {
          dishName: recipe.dish_name,
          sourceModule: 'recipe',
          servings: recipe.servings,
          ingredients: rows.map(({ i, role }) => ({
            name: i.name,
            amount: Number.isFinite(Number(i.amount)) ? Number((Number(i.amount) * factor).toFixed(2)) : null,
            unit: i.unit || '',
            role,
          })),
        };
      }

      function refreshNutrition() {
        activeNutrition?.update(nutritionPayload());
      }

      function editAmount(item, amountEl) {
        const oldText = `${fmtAmount(item.amount * factor)} ${item.unit}`;
        const input = h('input', {
          class: 'ing__amount-input',
          type: 'number',
          min: '0',
          step: '1',
          value: String(fmtAmount(item.amount * factor)),
          'aria-label': `修改${item.name}的用量（${item.unit}）`,
        });
        const editor = h('span', { class: 'ing__amount-editor' }, input, h('span', { class: 'ing__amount-unit', text: ` ${item.unit}` }));
        amountEl.replaceWith(editor);
        let closed = false;
        const close = (save) => {
          if (closed) return;
          closed = true;
          if (save) {
            const next = Number(input.value);
            if (Number.isFinite(next) && next > 0) {
              // 用户看到的是按当前人数缩放后的量，写回基础配方时要除回 factor。
              item.amount = Number((next / factor).toFixed(2));
            }
          }
          paintIngredients();
          refreshNutrition();
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            close(true);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            close(false);
          }
        });
        input.addEventListener('blur', () => close(true));
        requestAnimationFrame(() => {
          input.focus();
          input.select();
        });
        input.title = `原用量：${oldText}`;
      }

      function paintIngredients() {
        clear(ingList);
        const rows = [
          ...recipe.ingredients.map((i) => ({ i, role: 'main' })),
          ...recipe.seasonings.map((i) => ({ i, role: 'aux' })),
        ];
        rows.forEach(({ i }, idx) => {
          const amountEl = h('span', {
            class: 'ing__amount ing__amount--editable',
            role: 'button',
            tabindex: '0',
            title: '点击修改用量，营养分析会一起更新',
            onclick: () => editAmount(i, amountEl),
            onkeydown: (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                editAmount(i, amountEl);
              }
            },
          }, `${fmtAmount(i.amount * factor)} ${i.unit}`);
          const li = h('li', { class: 'ing' },
            h('input', { type: 'checkbox', 'aria-label': `${i.name} 已备好`, onchange: (e) => li.classList.toggle('is-done', e.target.checked) }),
            h('span', { class: 'ing__name', text: i.name }),
            amountEl,
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
            usableTip(s.tips) ? h('p', { class: 'step__tips', text: `要点：${tipText(s.tips)}` }) : null
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
          ? '由已接入的模型综合公开资料整理，已通过 Schema 校验；来源见下方。'
          : '由已接入的模型按美食图鉴档案生成，已通过 Schema 校验。',
      }[meta.source] || '';

      const verify = meta.verification || {};
      const level = verify.level || (isAi ? 'ai-synthesized' : isKnowledge ? 'model-knowledge' : 'library');
      const noteLabel = level === 'ai-synthesized' ? 'AI 综合整理' : level === 'model-knowledge' ? '模型知识生成' : '美食图鉴';
      const noteShort =
        level === 'ai-synthesized'
          ? '根据公开资料综合整理，未经逐条人工核验，请以实际烹饪情况为准。'
          : level === 'model-knowledge'
            ? '本次未完成联网核实，菜谱依据模型已有知识整理，地方做法可能有差异。'
            : '依据站内图鉴菜品档案整理，未经逐条人工核验，请以实际烹饪情况为准。';
      const noteLong = [
        verify.note,
        sourceText,
        Array.isArray(meta.sources) && meta.sources.length
          ? `本次共检索到 ${meta.sources.length} 条公开资料，可在下方「资料来源」里逐条展开核对。`
          : '',
      ]
        .filter(Boolean)
        .join(' ');

      const noteDetail = h('p', { class: 'rc-note__detail', hidden: true, text: noteLong });
      const noteMore = h('button', { class: 'rc-note__more', type: 'button', 'aria-expanded': 'false', text: '查看说明' });
      const noteBar = h('div', { class: `rc-note rc-note--${level === 'library' ? 'lib' : level === 'model-knowledge' ? 'warn' : 'ai'}` },
        h('div', { class: 'rc-note__row' },
          h('span', { class: 'rc-note__icon', 'aria-hidden': 'true', text: '✳' }),
          h('b', { class: 'rc-note__label', text: noteLabel }),
          h('p', { class: 'rc-note__text', text: noteShort }),
          noteMore
        ),
        noteDetail
      );
      noteMore.addEventListener('click', () => {
        const open = noteDetail.hidden;
        noteDetail.hidden = !open;
        noteBar.classList.toggle('is-open', open);
        noteMore.textContent = open ? '收起说明' : '查看说明';
        noteMore.setAttribute('aria-expanded', String(open));
      });

      const metaPill = (label, value) =>
        h('span', { class: 'recipe-meta__item' }, h('em', { text: label }), h('b', { text: value }));

      activeNutrition = createNutritionCard(nutritionPayload(), { title: '这道菜的营养成分' });

      const card = h(
        'article',
        { class: 'recipe-card' },
        h('header', { class: 'recipe-head' },
          thumbFor(dish, recipe.dish_name, meta.image),
          h('div', { class: 'recipe-head__main' },
            h('div', { class: 'recipe-head__title' },
              h('h2', { text: recipe.dish_name }),
              h('span', {
                class: `recipe-source-badge recipe-source-badge--${isKnowledge ? 'knowledge' : isAi ? 'ai' : 'library'}`,
                text: isKnowledge ? '模型知识' : isAi ? 'AI 检索' : '美食图鉴',
              })
            ),
            h('div', { class: 'recipe-meta' },
              metaPill('准备', `${recipe.prep_time_minutes} 分钟`),
              metaPill('烹饪', `${recipe.cook_time_minutes} 分钟`),
              metaPill('难度', String(DIFFICULTY_LABEL[recipe.difficulty] || recipe.difficulty)),
              ...recipe.taste_profile.map((t) => h('span', { class: 'recipe-tag', text: t }))
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
        noteBar,
        h('div', { class: 'recipe-cols' },
          h('div', { class: 'recipe-col recipe-col--ing' },
            h('section', { class: 'recipe-block' },
              h('div', { class: 'recipe-block__head' },
                h('h3', { text: '食材与调味' }),
                h('div', { class: 'servings' },
                  h('button', { type: 'button', 'aria-label': '减少人数', onclick: () => change(-1) }, '−'),
                  servingsLabel,
                  h('button', { type: 'button', 'aria-label': '增加人数', onclick: () => change(1) }, '+')
                )
              ),
              ingList
            ),
            h('section', { class: 'recipe-block recipe-block--sub' },
              h('h4', { class: 'recipe-sub__title', text: '替代方案' }),
              recipe.substitutions.length
                ? h('ul', { class: 'rc-list' }, ...recipe.substitutions.map((x) => h('li', { text: x })))
                : h('p', { class: 'rc-empty', text: '暂无替代方案' })
            )
          ),
          h('div', { class: 'recipe-col recipe-col--steps' },
            h('section', { class: 'recipe-block' },
              h('div', { class: 'recipe-block__head' },
                h('h3', { text: '制作步骤' }),
                h('span', { class: 'rc-count', text: `${recipe.steps.length} 步` })
              ),
              steps
            )
          )
        ),
        activeNutrition.el,
        recipe.common_mistakes.length || recipe.safety_notes.length
          ? h('div', { class: 'recipe-duo' },
              recipe.common_mistakes.length
                ? h('section', { class: 'recipe-block recipe-block--fail' },
                    h('h3', { text: '常见失败与补救' }),
                    h('ul', { class: 'rc-list' }, ...recipe.common_mistakes.map((x) => h('li', { text: x })))
                  )
                : null,
              recipe.safety_notes.length
                ? h('section', { class: 'recipe-block recipe-block--safe' },
                    h('h3', { text: '安全提示' }),
                    h('ul', { class: 'rc-list' }, ...recipe.safety_notes.map((x) => h('li', { text: x })))
                  )
                : null
            )
          : null,
        epicurePanel({ recipeAnalysis: meta.epicureAnalysis }),
        sourcesBlock(meta)
      );

      function change(delta) {
        const next = Math.min(12, Math.max(1, recipe.servings + delta));
        if (next === recipe.servings) return;
        recipe.servings = next;
        factor = next / baseServings;
        servingsLabel.textContent = `${next} 人份`;
        paintIngredients();
        refreshNutrition();
      }

      paintIngredients();
      clear(result);
      result.append(card);

      /* 手机只有一张纸：菜谱排在表单下面，生成完直接滚到结果，省得用户自己找 */
      if (document.querySelector('.bk-stage.is-single')) {
        requestAnimationFrame(() => {
          const box = result.closest('.bk-pageface');
          if (!box) return;
          const top = result.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
          box.scrollTo({ top: Math.max(0, top - 8), behavior: 'smooth' });
        });
      }
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

    /*
     * ---------------- 菜名自动填充（全站「生成菜谱」统一入口） ----------------
     *
     * 填的是页面上原有的这个 input，不新建字段、不重复加一项。
     * AI 原创推荐会通过 recipeContext 一并带上主要食材、口味和用户需求；
     * 这些只是预填，用户仍可逐项改，填完绝不自动生成。
     */
    let lastPrefillAt = 0;

    function applyPrefill(task) {
      const name = String(task?.dishName || '').trim().slice(0, 30);
      if (!name) return false;
      dishInput.value = name;
      dishInput.dataset.autofilled = '1';
      dishInput.dataset.fillSource = 'nav';   // 来自「生成菜谱」那一下
      lastPrefillAt = Date.now();
      fieldError.hidden = true;
      const ctx = task?.recipeContext || null;
      if (ctx) {
        if (Array.isArray(ctx.ingredients) && ctx.ingredients.length) {
          ingredients.value = ctx.ingredients.join('、').slice(0, 200);
        }
        const rawTaste = [ctx.taste, ...(ctx.flavors || [])].map((x) => String(x || '').trim()).filter(Boolean);
        const tasteOpt = rawTaste.map((x) => TASTES.find((t) => t.name === x || x.includes(t.name) || t.name.includes(x))).find(Boolean);
        if (tasteOpt) taste.value = tasteOpt.name;
        if (ctx.servings && Number(ctx.servings) >= 1 && Number(ctx.servings) <= 12) servings.value = String(ctx.servings);
        if (['easy', 'medium', 'hard'].includes(String(ctx.difficulty || ''))) difficulty.value = String(ctx.difficulty);
        const needs = String(ctx.userNeeds || '').trim();
        if (needs) notes.value = needs.slice(0, 600);
        fieldHint.textContent = `已按「${name}」预填菜名、主要食材${needs ? '和你的需求' : ''}：可继续调整条件，确认后点「生成菜谱」。`;
      } else {
        fieldHint.textContent = `已按「${name}」预填菜名：可继续调整条件，确认后点「生成菜谱」。`;
      }
      return true;
    }

    /*
     * 两条来源：
     * 1. 统一导航任务（用户刚点的那一下；一次性消费，消费后立刻失效）；
     * 2. 地址参数（刷新 / 分享链接 / 独立页整页进入时兜底）。
     */
    const bootTask = consumeRecipeNav();
    if (bootTask) {
      applyPrefill(bootTask);
    } else if (presetName) {
      dishInput.dataset.autofilled = '1';
      dishInput.dataset.fillSource = 'url';   // 来自地址（刷新 / 分享链接），不该被收回
      fieldHint.textContent = `已按「${presetName}」预填菜名：可继续调整条件，确认后点「生成菜谱」。`;
    }

    /* 画册翻页落地后再进来的一次性回填：模块已挂载时也要能收到 */
    const onRecipeNav = (event) => {
      const task = consumeRecipeNav(event?.detail?.navigationId);
      if (task) applyPrefill(task);
    };
    window.addEventListener(RECIPE_NAV_EVENT, onRecipeNav);

    /* 用户自己打过字：这一格就不再算「自动填的」，后面也不该被收回 */
    dishInput.addEventListener('input', () => {
      dishInput.dataset.autofilled = '0';
    });

    /*
     * 从书签 / 目录普通进入菜谱章（不是「生成菜谱」带过来的）：
     * 把上一次自动填进去的菜名收回去，书签入口不该带着上一道菜。
     * 用户自己改过的名字不动。
     */
    const onPlainEnter = () => {
      // 删的是「上一次生成菜谱留下」的名字；地址参数带来的名字属于当前地址，保留
      if (dishInput.dataset.fillSource === 'url') return;
      // 刚被「生成菜谱」回填过（落地与派发在同一拍）：这一下不算普通进入
      if (Date.now() - lastPrefillAt < 2000) return;
      if (dishInput.dataset.autofilled !== '1') return;
      dishInput.value = '';
      dishInput.dataset.autofilled = '0';
      dishInput.dataset.fillSource = '';
      fieldHint.textContent = '';
      fieldError.hidden = true;
    };
    window.addEventListener('foodsoul:recipe-enter', onPlainEnter);

    return {
      destroy() {
        window.removeEventListener(RECIPE_NAV_EVENT, onRecipeNav);
        window.removeEventListener('foodsoul:recipe-enter', onPlainEnter);
        activeNutrition?.destroy();
        activeNutrition = null;
      },
    };
  },
};
