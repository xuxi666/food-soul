import { h, clear, toast } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { PRESETS, presetOf } from '../data/aiPresets.js';

/**
 * 右上角账号与「接入 AI」入口。
 * 密钥只在服务端加密保存；前端只读取状态、服务商与模型展示名。
 */


function statusInfo(ai, siteAi) {
  // 全站内置 AI 优先：开启时所有人看到的都是内置模型状态
  if (siteAi?.enabled) {
    return {
      full: `内置 AI 已启用 · ${siteAi.model || '模型'}`,
      short: '内置 AI',
      tone: 'ok',
      title: `全站使用管理员配置的内置模型：${siteAi.model || ''}`,
    };
  }
  if (!ai || !ai.configured) {
    return {
      full: '当前未接入 AI 大模型',
      short: '未接入',
      tone: 'off',
      title: '当前未接入 AI 大模型',
    };
  }
  if (ai.status === 'failed') {
    const msg = ai.lastError || '请检查配置';
    return { full: `AI 接入失败：${msg}`, short: '接入失败', tone: 'error', title: `AI 接入失败：${msg}` };
  }
  if (ai.status === 'unavailable') {
    return {
      full: '模型暂时不可用，请稍后重试',
      short: '不可用',
      tone: 'warn',
      title: '模型暂时不可用，请稍后重试',
    };
  }
  if (ai.verified) {
    return { full: `已接入：${ai.model}`, short: '已接入', tone: 'ok', title: `已接入：${ai.model}` };
  }
  return { full: '已保存配置，尚未验证', short: '待验证', tone: 'warn', title: '已保存配置，尚未验证' };
}

/** 画册右上角：优先显示真正在线（已通过服务端连接测试）的模型 ID。 */
function bookAiStatus(ai, siteAi) {
  if (siteAi?.enabled) {
    const model = String(siteAi.model || '').trim();
    return {
      short: model || '在线',
      tone: 'ok',
      model,
      title: model
        ? `当前在线模型：${model}（全站内置 AI，不是 Epicure 外部 MCP）`
        : '全站内置 AI 已连接（不是 Epicure 外部 MCP）',
    };
  }
  if (siteAi?.masterEnabled) {
    if (!siteAi.configured) {
      return {
        short: '未配置',
        tone: 'off',
        model: '',
        title: '全站内置 AI 已开启，但还没有配置模型',
      };
    }
    return {
      short: '连接异常',
      tone: 'error',
      model: '',
      title: '全站内置 AI 的配置未通过连接测试，当前不可用',
    };
  }
  if (!ai?.configured) {
    return { short: '未配置', tone: 'off', model: '', title: 'AI 未配置，点击接入' };
  }
  if (ai.status === 'failed') {
    return {
      short: '连接异常',
      tone: 'error',
      model: '',
      title: `AI 连接异常：${ai.lastError || '请检查配置'}`,
    };
  }
  if (ai.status === 'unavailable') {
    return { short: '暂不可用', tone: 'warn', model: '', title: 'AI 暂时不可用，请稍后重试' };
  }
  if (ai.verified) {
    const model = String(ai.model || '').trim();
    return {
      short: model || '在线',
      tone: 'ok',
      model,
      title: model ? `当前在线模型：${model}（个人配置）` : '个人 AI 已连接',
    };
  }
  return {
    short: '待验证',
    tone: 'warn',
    model: '',
    title: 'AI 配置已保存，尚未通过连接测试',
  };
}

const BOOK_SPARK_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M12 3.5l1.5 4.2 4.2 1.5-4.2 1.5L12 15l-1.5-4.3L6.3 9.2l4.2-1.5L12 3.5z"/>' +
  '<path d="M18.5 15.2l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8.8-2.1z"/>' +
  '<path d="M5.2 15.6l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6.6-1.6z"/>' +
  '</svg>';

/**
 * 供其他页面唤起登录弹窗（如社区发布前未登录）。
 * mountAccount 时绑定真实实现，未挂载时调用是空操作。
 */
let openAuthRef = null;
export function openAuthModal(tab = 'login') {
  openAuthRef?.(tab);
}

export function mountAccount(root, { variant = 'default' } = {}) {
  if (!root) return null;
  const bookMode = variant === 'book';

  const state = {
    me: null,
    loading: true,
    modal: null,
    modalKeyHandler: null,
    testing: false,
    verifyToken: '',
    menuOpen: false,
    userMenu: null,
    userBtn: null,
  };

  const bar = h('div', { class: bookMode ? 'bk-account' : 'account-bar' });
  root.append(bar);

  /* ---------------- 状态 ---------------- */

  async function refresh() {
    try {
      state.me = await api.auth.me();
    } catch {
      state.me = { user: null, ai: { configured: false, verified: false, status: 'not_configured' } };
    }
    state.loading = false;
    renderBar();

    try {
      if (sessionStorage.getItem('openAiAfterLogin') === '1' && state.me?.user) {
        sessionStorage.removeItem('openAiAfterLogin');
        setTimeout(() => openAiModal(), 180);
      }
    } catch {
      /* noop */
    }

    // 通知页面（如社区）登录态变化
    try {
      window.dispatchEvent(new CustomEvent('foodsoul:auth', { detail: state.me }));
    } catch {
      /* noop */
    }
  }

  function renderBar() {
    if (state.menuOpen) closeUserMenu();
    clear(bar);
    if (bookMode) {
      renderBookBar();
      return;
    }
    if (state.loading) {
      bar.append(h('span', { class: 'account-status account-status--off', text: '读取 AI 状态…' }));
      return;
    }
    const user = state.me?.user;
    const info = statusInfo(state.me?.ai, state.me?.siteAi);

    bar.append(
      h(
        'span',
        { class: `account-status account-status--${info.tone}`, title: info.title },
        h('i', { class: `account-status__dot account-status__dot--${info.tone}`, 'aria-hidden': 'true' }),
        h('span', { class: 'account-status__full', text: info.full }),
        h('span', { class: 'account-status__short', text: info.short })
      ),
      h(
        'button',
        {
          class: 'account-btn account-btn--ai',
          type: 'button',
          onclick: () => {
            if (!state.me?.user) {
              try {
                sessionStorage.setItem('openAiAfterLogin', '1');
              } catch {
                /* noop */
              }
              openAuth('login', true);
            } else {
              openAiModal();
            }
          },
        },
        '接入 AI'
      )
    );

    if (user) {
      /*
       * 管理后台入口：只有服务端 /api/auth/me 返回 role=admin 时才渲染。
       * 真正的守卫在服务端 requireAdmin（/api/admin/* 全部 401/403）。
       */
      if (user.role === 'admin') {
        bar.append(
          h(
            'a',
            {
              class: 'account-btn account-btn--ghost',
              href: '/admin',
              'data-link': '',
              title: '进入管理员后台',
            },
            '管理员后台'
          )
        );
      }
      bar.append(
        h('span', { class: 'account-user', text: user.name || user.email, title: user.email }),
        h('button', { class: 'account-btn account-btn--ghost', type: 'button', onclick: () => logout() }, '退出')
      );
    } else {
      bar.append(
        h(
          'button',
          {
            class: 'account-btn account-btn--ghost',
            type: 'button',
            onclick: () => openAuth('login', false),
          },
          '登录 / 注册'
        )
      );
    }
  }

  /* ---------------- 画册右上角：用户名 + 接入 AI ---------------- */

  function closeUserMenu() {
    const wasOpen = state.menuOpen;
    if (state.userMenu) {
      state.userMenu.hidden = true;
      state.userMenu.classList.remove('is-open');
    }
    state.userBtn?.setAttribute('aria-expanded', 'false');
    state.menuOpen = false;
    return wasOpen;
  }

  function toggleUserMenu() {
    if (!state.userMenu || !state.me?.user) return false;
    if (state.menuOpen) {
      closeUserMenu();
      return true;
    }
    closeUserMenu();
    state.menuOpen = true;
    state.userMenu.hidden = false;
    state.userMenu.classList.add('is-open');
    state.userBtn?.setAttribute('aria-expanded', 'true');
    return true;
  }

  function renderBookBar() {
    if (state.loading) {
      const userLoading = h(
        'div',
        { class: 'bk-user-entry' },
        h(
          'button',
          { class: 'bk-user-btn is-loading', type: 'button', disabled: true },
          h('span', { class: 'bk-user-btn__avatar', 'aria-hidden': 'true', text: '…' }),
          h('span', { class: 'bk-user-btn__name', text: '读取账号…' })
        )
      );
      const aiLoading = h(
        'button',
        { class: 'bk-ai-btn is-loading', type: 'button', disabled: true },
        h('span', { class: 'bk-ai-btn__icon', html: BOOK_SPARK_ICON }),
        h('span', { class: 'bk-ai-btn__label', text: '接入 AI' }),
        h('span', { class: 'bk-ai-btn__state', text: '读取中…' })
      );
      bar.append(aiLoading, userLoading);
      return;
    }

    const user = state.me?.user;
    const displayName = String(user?.name || user?.email || '').trim();
    const initial = user ? (displayName || user.email || '客').trim().slice(0, 1) : '登';
    const userBtn = h(
      'button',
      {
        class: 'bk-user-btn',
        type: 'button',
        'aria-haspopup': user ? 'menu' : 'dialog',
        'aria-expanded': 'false',
        title: user ? `当前账号：${user.email || displayName}` : '登录或注册',
        onclick: (e) => {
          e.stopPropagation();
          if (!user) {
            closeUserMenu();
            openAuth('login', false);
            return;
          }
          toggleUserMenu();
        },
      },
      h('span', { class: 'bk-user-btn__avatar', 'aria-hidden': 'true', text: initial }),
      h('span', {
        class: 'bk-user-btn__name',
        text: user ? displayName || user.email : '登录 / 注册',
      }),
      h('span', { class: 'bk-user-btn__chev', 'aria-hidden': 'true', text: '⌄' })
    );

    let menu = null;
    if (user) {
      menu = h('div', { class: 'bk-user-menu', role: 'menu', hidden: true });
      menu.append(
        h(
          'div',
          { class: 'bk-user-menu__head' },
          h('span', { class: 'bk-user-menu__avatar', 'aria-hidden': 'true', text: initial }),
          h(
            'div',
            { class: 'bk-user-menu__who' },
            h('span', { class: 'bk-user-menu__eyebrow', text: '当前账号' }),
            h('strong', { text: displayName || user.email }),
            h('span', { class: 'bk-user-menu__email', text: user.email || '' })
          )
        )
      );

      if (user.role === 'admin') {
        menu.append(
          h(
            'a',
            {
              class: 'bk-user-menu__item bk-user-menu__item--admin',
              href: '/admin',
              'data-link': '',
              role: 'menuitem',
              title: '进入管理员后台',
              onclick: () => closeUserMenu(),
            },
            h('span', { class: 'bk-user-menu__item-main', text: '管理员后台' }),
            h('span', { class: 'bk-user-menu__item-note', text: '仅管理员可见' }),
            h('span', { class: 'bk-user-menu__item-go', 'aria-hidden': 'true', text: '›' })
          )
        );
      }

      menu.append(
        h(
          'button',
          {
            class: 'bk-user-menu__item bk-user-menu__item--logout',
            type: 'button',
            role: 'menuitem',
            onclick: () => void logout(true),
          },
          h('span', { class: 'bk-user-menu__item-main', text: '退出登录' })
        )
      );
    }

    const userEntry = h('div', { class: 'bk-user-entry' }, userBtn, menu);
    const aiInfo = bookAiStatus(state.me?.ai, state.me?.siteAi);
    const aiBtn = h(
      'button',
      {
        class: 'bk-ai-btn',
        type: 'button',
        title: `${aiInfo.title} · 点击配置`,
        'aria-label': aiInfo.model
          ? `接入 AI，当前在线模型 ${aiInfo.model}`
          : `接入 AI，${aiInfo.title}`,
        onclick: () => {
          closeUserMenu();
          if (!state.me?.user) {
            try {
              sessionStorage.setItem('openAiAfterLogin', '1');
            } catch {
              /* noop */
            }
            openAuth('login', true);
            return;
          }
          openAiModal();
        },
      },
      h('span', { class: 'bk-ai-btn__icon', 'aria-hidden': 'true', html: BOOK_SPARK_ICON }),
      h('span', { class: 'bk-ai-btn__label', text: '接入 AI' }),
      h('span', { class: `bk-ai-btn__state is-${aiInfo.tone}`, text: aiInfo.short })
    );

    state.userBtn = userBtn;
    state.userMenu = menu;
    bar.append(aiBtn, userEntry);
  }

  document.addEventListener('click', (e) => {
    if (!state.menuOpen) return;
    if (bar.contains(e.target)) return;
    closeUserMenu();
  });

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape') return;
      if (state.modal) {
        closeModal();
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (state.menuOpen) {
        closeUserMenu();
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );

  async function logout(confirmFirst = false) {
    if (confirmFirst && !window.confirm('确认退出登录？退出后需要重新登录。')) return false;
    closeUserMenu();
    try {
      await api.auth.logout();
    } catch (err) {
      toast(err?.message || '退出登录失败，请稍后重试', 'err');
      return false;
    }
    try {
      sessionStorage.removeItem('openAiAfterLogin');
    } catch {
      /* noop */
    }
    // 退出后回到首页封面：不把未登录用户留在受保护页或内页
    location.assign('/');
    return true;
  }

  /* ---------------- 弹窗 ---------------- */

  function closeModal() {
    if (!state.modal) return;
    if (state.modalKeyHandler) document.removeEventListener('keydown', state.modalKeyHandler);
    state.modal.remove();
    state.modal = null;
    state.modalKeyHandler = null;
  }

  function openModal({ title, subtitle, body, footer }) {
    closeUserMenu();
    closeModal();
    const card = h('div', { class: 'account-modal', role: 'dialog', 'aria-modal': 'true' });
    const head = h(
      'div',
      { class: 'account-modal__head' },
      h('div', {}, h('h2', { text: title }), subtitle ? h('p', { text: subtitle }) : null),
      h(
        'button',
        { class: 'account-modal__close', type: 'button', 'aria-label': '关闭', onclick: closeModal },
        '×'
      )
    );
    const bodyEl = h('div', { class: 'account-modal__body' }, ...(Array.isArray(body) ? body : [body]));
    card.append(head, bodyEl);
    if (footer) {
      card.append(h('div', { class: 'account-modal__foot' }, ...(Array.isArray(footer) ? footer : [footer])));
    }
    const backdrop = h(
      'div',
      {
        class: 'account-modal-backdrop',
        onclick: (e) => {
          if (e.target === backdrop) closeModal();
        },
      },
      card
    );
    document.body.append(backdrop);
    state.modal = backdrop;
    state.modalKeyHandler = (e) => {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', state.modalKeyHandler);
    setTimeout(() => card.querySelector('input, select, button')?.focus(), 40);
    return card;
  }

  function field(label, control, hint) {
    return h(
      'label',
      { class: 'account-field' },
      h('span', { text: label }),
      control,
      hint ? h('small', { class: 'account-hint', text: hint }) : null
    );
  }

  /* ---------------- 登录 / 注册 ---------------- */

  function openAuth(initialTab = 'login', thenAi = false) {
    closeUserMenu();
    openAuthRef = openAuth;
    let tab = initialTab;
    const error = h('p', { class: 'account-error', hidden: true });
    const email = h('input', {
      class: 'account-input',
      type: 'email',
      placeholder: 'you@example.com',
      autocomplete: 'email',
    });
    const password = h('input', {
      class: 'account-input',
      type: 'password',
      placeholder: '至少 8 位',
      autocomplete: 'current-password',
    });
    const name = h('input', {
      class: 'account-input',
      type: 'text',
      placeholder: '怎么称呼你（可选）',
      maxlength: '20',
    });
    const nameField = field('昵称', name);
    const tabs = h('div', { class: 'account-tabs' });
    const submit = h('button', { class: 'account-primary', type: 'submit' }, '登录');

    const loginTab = h('button', { class: 'account-tab', type: 'button' }, '登录');
    const registerTab = h('button', { class: 'account-tab', type: 'button' }, '注册');
    tabs.append(loginTab, registerTab);

    function setTab(next) {
      tab = next;
      loginTab.classList.toggle('is-on', tab === 'login');
      registerTab.classList.toggle('is-on', tab === 'register');
      nameField.hidden = tab !== 'register';
      password.setAttribute('autocomplete', tab === 'register' ? 'new-password' : 'current-password');
      submit.textContent = tab === 'register' ? '注册' : '登录';
      error.hidden = true;
    }
    loginTab.addEventListener('click', () => setTab('login'));
    registerTab.addEventListener('click', () => setTab('register'));
    setTab(tab);

    const form = h(
      'form',
      { class: 'account-form' },
      tabs,
      field('邮箱', email),
      field('密码', password),
      nameField,
      error,
      submit
    );

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.hidden = true;
      const payload = { email: email.value.trim(), password: password.value };
      if (tab === 'register') payload.name = name.value.trim();
      if (!payload.email || !payload.password) {
        error.textContent = '请填写邮箱和密码';
        error.hidden = false;
        return;
      }
      submit.disabled = true;
      submit.textContent = tab === 'register' ? '注册中…' : '登录中…';
      try {
        if (tab === 'register') await api.auth.register(payload);
        else await api.auth.login(payload);
        if (thenAi) {
          try {
            sessionStorage.setItem('openAiAfterLogin', '1');
          } catch {
            /* noop */
          }
        }
        location.reload();
      } catch (err) {
        error.textContent = err.message || '操作失败';
        error.hidden = false;
        submit.disabled = false;
        submit.textContent = tab === 'register' ? '注册' : '登录';
      }
    });

    openModal({
      title: '登录 / 注册',
      subtitle: '登录后，你的 AI 模型配置只会绑定到当前账号，其他账号无法读取或使用。',
      body: form,
    });
  }

  /* ---------------- 接入 AI ---------------- */

  async function openAiModal() {
    closeUserMenu();
    if (!state.me?.user) {
      try {
        sessionStorage.setItem('openAiAfterLogin', '1');
      } catch {
        /* noop */
      }
      openAuth('login', true);
      return;
    }

    let config = null;
    try {
      config = await api.ai.config();
    } catch (err) {
      toast(err.message || '读取 AI 配置失败', 'err');
      return;
    }

    state.verifyToken = '';
    const provider = h(
      'select',
      { class: 'account-input' },
      ...PRESETS.map((p) =>
        h('option', { value: p.id, text: p.label, selected: (config.provider || 'custom') === p.id })
      )
    );
    const baseUrl = h('input', {
      class: 'account-input',
      type: 'url',
      placeholder: 'https://api.example.com/v1',
      value: config.baseUrl || presetOf(config.provider || 'custom').baseUrl,
    });
    const apiKey = h('input', {
      class: 'account-input',
      type: 'password',
      placeholder: config.keyConfigured ? '已保存，留空则不修改' : '输入你的 API Key',
      autocomplete: 'new-password',
    });
    const model = h('input', {
      class: 'account-input',
      type: 'text',
      placeholder: presetOf(config.provider || 'custom').hint,
      value: config.model || '',
      list: 'ai-model-list',
    });
    const modelList = h('datalist', { id: 'ai-model-list' });
    const status = h('div', { class: 'account-status-box' });
    const testBtn = h('button', { class: 'account-btn', type: 'button' }, '测试连接');
    const saveBtn = h('button', { class: 'account-primary', type: 'button', disabled: true }, '保存并接入');
    const modelsBtn = h('button', { class: 'account-btn', type: 'button' }, '拉取模型列表');
    const clearBtn = config.configured
      ? h('button', { class: 'account-btn account-btn--danger', type: 'button' }, '清除配置')
      : null;

    function setStatus(text, tone = '') {
      status.className = `account-status-box${tone ? ` account-status-box--${tone}` : ''}`;
      status.textContent = text || '';
      status.hidden = !text;
    }

    function invalidate() {
      state.verifyToken = '';
      saveBtn.disabled = true;
      setStatus('', '');
    }

    function fields() {
      return {
        provider: provider.value,
        baseUrl: baseUrl.value.trim(),
        apiKey: apiKey.value.trim(),
        model: model.value.trim(),
      };
    }

    provider.addEventListener('change', () => {
      const preset = presetOf(provider.value);
      baseUrl.value = preset.baseUrl;
      model.placeholder = preset.hint;
      invalidate();
    });
    [baseUrl, apiKey, model].forEach((el) => el.addEventListener('input', invalidate));

    testBtn.addEventListener('click', async () => {
      const f = fields();
      if (!f.baseUrl || !f.model) {
        setStatus('请填写 API Base URL 和模型 ID', 'error');
        return;
      }
      if (!f.apiKey && !config.keyConfigured) {
        setStatus('请填写 API Key', 'error');
        return;
      }
      state.testing = true;
      testBtn.disabled = true;
      saveBtn.disabled = true;
      setStatus('正在验证模型连接…', 'pending');
      try {
        const res = await api.ai.test(f);
        if (res.ok) {
          state.verifyToken = res.verifyToken;
          saveBtn.disabled = false;
          setStatus(`连接成功：${res.model}${res.latency ? `（${res.latency}ms）` : ''}`, 'ok');
        } else {
          setStatus(`连接失败：${res.error || '未知错误'}`, 'error');
        }
      } catch (err) {
        setStatus(`连接失败：${err.message || '网络异常'}`, 'error');
      } finally {
        state.testing = false;
        testBtn.disabled = false;
      }
    });

    modelsBtn.addEventListener('click', async () => {
      const f = fields();
      if (!f.baseUrl) {
        setStatus('请先填写 API Base URL', 'error');
        return;
      }
      modelsBtn.disabled = true;
      try {
        const res = await api.ai.models(f);
        if (res.ok && res.models?.length) {
          clear(modelList);
          res.models.forEach((id) => modelList.append(h('option', { value: id })));
          setStatus(`已获取 ${res.models.length} 个模型，可在输入框中选择或继续输入`, 'ok');
        } else {
          setStatus(res.error || '该服务商不支持模型列表，请手动填写模型 ID', 'warn');
        }
      } catch (err) {
        setStatus(err.message || '获取模型列表失败', 'error');
      } finally {
        modelsBtn.disabled = false;
      }
    });

    saveBtn.addEventListener('click', async () => {
      if (!state.verifyToken) {
        setStatus('请先完成连接测试', 'error');
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = '保存中…';
      try {
        await api.ai.save({ ...fields(), verifyToken: state.verifyToken });
        toast('已接入 AI 大模型');
        setTimeout(() => location.reload(), 300);
      } catch (err) {
        setStatus(`保存失败：${err.message || '请重试'}`, 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = '保存并接入';
      }
    });

    clearBtn?.addEventListener('click', async () => {
      if (!confirm('确认清除当前账号的 AI 配置？清除后将无法使用 AI 聊天、菜谱与推荐。')) return;
      try {
        await api.ai.remove();
        toast('已清除 AI 配置');
        setTimeout(() => location.reload(), 300);
      } catch (err) {
        setStatus(`清除失败：${err.message || '请重试'}`, 'error');
      }
    });

    const currentText = config.configured
      ? `当前账号已保存：${config.model}${config.verified ? '（已验证）' : '（未验证）'}${
          config.lastError ? `；最近错误：${config.lastError}` : ''
        }`
      : '当前账号还没有接入 AI 大模型。';

    const siteAi = state.me?.siteAi;
    const body = [
      siteAi?.enabled
        ? h('p', { class: 'account-site-notice' },
            h('b', { text: '当前全站使用内置模型' }),
            h('span', { text: `：${siteAi.model || '模型'}。你的个人配置会被保存，但内置 AI 开启期间不会生效；管理员关闭后才会切回个人模型。` })
          )
        : null,
      h('p', { class: 'account-current', text: currentText }),
      field('模型服务商', provider),
      field('API Base URL', baseUrl, '填服务商的 OpenAI 兼容接口地址；以 /chat/completions 结尾也可以。'),
      field('API Key', apiKey, '只发送到本站服务端，AES-256-GCM 加密保存；不会回显，也不会写入浏览器存储。'),
      field(
        '模型 ID',
        h('div', { class: 'account-model-row' }, model, modelsBtn),
        '必须填写服务商实际支持的模型 ID，而不是展示名称。'
      ),
      modelList,
      status,
      h('p', { class: 'account-hint', text: '保存前必须通过真实连接测试；测试会向该模型发起一次最小请求。' }),
    ];

    const footer = [
      clearBtn || h('span'),
      h('div', { class: 'account-actions' }, testBtn, saveBtn),
    ];

    openModal({
      title: '接入 AI 大模型',
      subtitle: '使用你自己的 OpenAI 兼容模型；每个账号的配置相互隔离。',
      body,
      footer,
    });
    setStatus(config.lastError ? `最近一次失败：${config.lastError}` : '', config.lastError ? 'error' : '');
  }

  // 暴露给其他页面（社区发布前未登录时唤起登录框）
  openAuthRef = openAuth;

  // 管理员切换内置 AI 开关后，右上角状态立即刷新
  window.addEventListener('foodsoul:auth-changed', () => {
    if (!bar.isConnected) return;
    refresh();
  });

  function closeTopOverlay() {
    if (state.modal) {
      closeModal();
      return true;
    }
    if (state.menuOpen) {
      closeUserMenu();
      return true;
    }
    return false;
  }

  refresh();
  return {
    closeMenu: closeUserMenu,
    closeTopOverlay,
    hasOverlay: () => Boolean(state.modal || state.menuOpen),
    refresh,
  };
}
