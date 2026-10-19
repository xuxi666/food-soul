import './styles/base.css';
import './styles/home.css';
import './styles/app.css';
import './styles/community.css';
import './styles/account.css';

import { initRouter } from './router.js';
import { mountMascot } from './components/mascot.js';
import { mountAccount } from './components/account.js';

initRouter(document.getElementById('view'));
mountMascot(document.getElementById('mascot-root'));
mountAccount(document.getElementById('account-root'));

if (import.meta.hot) {
  import.meta.hot.dispose(() => {});
}
