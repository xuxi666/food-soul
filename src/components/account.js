import { h, clear, toast } from '../lib/dom.js';
import { api } from '../lib/api.js';

/**
 * 右上角账号与「接入 AI」入口。
 * 密钥只在服务端加密保存；前端只读取状态、服务商与模型展示名。
 */

const PRESETS = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', hint: '例如 gpt-4o-mini' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', hint: '例如 deepseek-chat' },
  { id: 'moonshot', label: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1', hint: '例如 moonshot-v1-8k' },
  {
    id: 'zhipu',
    label: '智谱（OpenAI 兼容）',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    hint: '例如 glm-4-flash',
  },
  { id: 'custom', label: '自定义（OpenAI 兼容）', baseUrl: '', hint: '填写服务商文档中的模型 ID' },
];

function presetOf(id) {
  return PRESETS.find((p) => p.id === id) || PRESETS[PRESETS.length - 1];
}

function statusInfo(ai) {
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

/**
 * 供其他页面唤起登录弹窗（如社区发布前未登录）。
 * mountAccount 时绑定真实实现，未挂载时调用是空操作。
 */
let openAuthRef = null;
export function openAuthModal(tab = 'login') {
  openAuthRef?.(tab);
}

export function mountAccount(root) {
  if (!root) return;

  const state = {
    me: null,
    loading: true,
    modal: null,
    modalKeyHandler: null,
    testing: false,
    verifyToken: '',
  };

  const bar = h('div', { class: 'account-bar' });
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
    clear(bar);
    if (state.loading) {
      bar.append(h('span', { class: 'account-status account-status--off', text: '读取 AI 状态…' }));
      return;
    }
    const user = state.me?.user;
    const info = statusInfo(state.me?.ai);

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
      bar.append(
        h('span', { class: 'account-user', text: user.name || user.email, title: user.email }),
        h('button', { class: 'account-btn account-btn--ghost', type: 'button', onclick: logout }, '退出')
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

  async function logout() {
    try {
      await api.auth.logout();
    } catch {
      /* noop */
    }
    try {
      sessionStorage.removeItem('openAiAfterLogin');
    } catch {
      /* noop */
    }
    location.reload();
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

    const body = [
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

  refresh();
}
