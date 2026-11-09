import './styles/base.css';
import './styles/home.css';
import './styles/app.css';
import './styles/recipe.css';
import './styles/community.css';
import './styles/account.css';
import './styles/admin.css';
import './styles/kitchen.css';

import { initBook } from './book/index.js';
import { setRouterHost } from './router.js';
import { mountMascot } from './components/mascot.js';
import { loadAssetOverrides } from './lib/overrides.js';

// 先拉取管理员配置的图片覆盖，再渲染，避免首页先闪出默认图
const boot = async () => {
  await loadAssetOverrides();
  const bookRoot = document.getElementById('book-root');
  const { shell } = initBook({ root: bookRoot });
  // 详情页的共享元素过渡会把真实 DOM 接回内容层，这里告诉路由宿主是谁
  setRouterHost(shell.content);
  mountMascot(document.getElementById('mascot-root'));
};

boot();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {});
}
