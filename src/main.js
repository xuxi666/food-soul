import './styles/base.css';
import './styles/home.css';
import './styles/app.css';
import './styles/community.css';
import './styles/account.css';
import './styles/admin.css';

import { initRouter } from './router.js';
import { mountMascot } from './components/mascot.js';
import { mountAccount } from './components/account.js';
import { loadAssetOverrides } from './lib/overrides.js';

// 先拉取管理员配置的图片覆盖，再渲染，避免首页先闪出默认图
const boot = async () => {
  await loadAssetOverrides();
  initRouter(document.getElementById('view'));
  mountMascot(document.getElementById('mascot-root'));
  mountAccount(document.getElementById('account-root'));
};

boot();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {});
}
