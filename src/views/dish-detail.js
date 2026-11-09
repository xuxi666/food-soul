/**
 * 菜品详情页 /dishes/:id（书里的「内页」版本）
 * ------------------------------------------------------------
 * 内容与书页内扩散详情完全同源：都来自 book/dish-page.js，
 * 这里只负责套上纸张与页头，并按书的规则切到左右两张纸：
 *   左页 = 页头 + 主视觉 + 第一段
 *   右页 = 其余专题段落
 */
import { h, clear } from '../lib/dom.js';
import { DISH_BY_ID } from '../data/dishes.js';
import { CUISINE_BY_ID, TASTE_BY_ID } from '../data/cuisines.js';
import { getVisualTheme, applyTheme } from '../data/visualThemes.js';
import { api } from '../lib/api.js';
import { mountComments } from '../components/comments.js';
import { buildDishDoc } from '../book/dish-page.js';
import notFound from './notfound.js';

export default {
  async mount(root, params) {
    const id = params?.[0];
    let dish = DISH_BY_ID[id];
    if (!dish && id) {
      try {
        const remote = await api.dish(id);
        dish = remote?.dish || null;
      } catch {
        dish = null;
      }
    }
    if (!dish) return notFound.mount(root, params);

    const cuisine = CUISINE_BY_ID[dish.cuisine];
    const theme = getVisualTheme(dish.cuisine);
    const accent = theme.accent || cuisine?.accent || TASTE_BY_ID[(dish.tastes || [])[0]]?.color || '#d8b26a';

    const { el, comments } = buildDishDoc(dish, { accent, linkRelated: true });
    // 内页版：菜名/菜系/味型由详情自己的标题区统一呈现，页头只留返回入口，
    // 避免同一个菜名在一页里出现两次；切页按 .dm-top / .cat-block 拆两张纸
    el.querySelector('.dm-hero')?.classList.add('detail-hero');
    el.querySelectorAll('.dm-sec').forEach((s) => s.classList.add('cat-block'));

    const page = h(
      'div',
      { class: 'page theme-page', style: `--accent:${accent}` },
      h('div', { class: 'theme-glow', 'aria-hidden': 'true' }),
      h(
        'div',
        { class: 'wrap' },
        h(
          'div',
          { class: 'page-head' },
          h('a', { class: 'page-head__back', href: '/dishes', 'data-link': '' }, '← 返回图鉴'),
          h('div', { class: 'page-head__spacer' })
        ),
        el
      )
    );

    clear(root);
    applyTheme(page, dish.cuisine);
    root.append(page);
    mountComments(comments, dish.id);

    return { destroy() {} };
  },
};