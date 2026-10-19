import { h } from '../lib/dom.js';

export default {
  async mount(root) {
    root.append(
      h('div', { class: 'nf' },
        h('h1', { text: '404' }),
        h('p', { text: '这道菜不在菜单上。' }),
        h('a', { class: 'btn btn--sm btn--gold', href: '/', 'data-link': '' }, '回到首页')
      )
    );
    return { destroy() {} };
  },
};
