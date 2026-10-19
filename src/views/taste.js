import { buildCategoryPage } from './category.js';
import notFound from './notfound.js';

export default {
  async mount(root, [id]) {
    const page = buildCategoryPage({ kind: 'taste', id });
    if (!page) return notFound.mount(root);
    root.append(page);
    return { destroy() {} };
  },
};
