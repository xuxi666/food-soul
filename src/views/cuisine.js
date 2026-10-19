import { buildCategoryPage } from './category.js';
import notFound from './notfound.js';

export default {
  async mount(root, [id]) {
    const page = buildCategoryPage({ kind: 'cuisine', id });
    if (!page) return notFound.mount(root);
    root.append(page);
    return { destroy() {} };
  },
};
