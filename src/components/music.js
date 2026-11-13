import { h } from '../lib/dom.js';
import { MUSIC_TRACKS } from '../data/music.js';

/**
 * 全站背景音乐：一个 Audio 实例 + 一个固定左下角按钮。
 *
 * 生命周期：
 * - initMusic() 在 main.js 里只调用一次，播放器挂在 body 下，不进入画册 / 路由视图；
 * - 路由切换、翻页、开合、缩放都只是改画册，不会碰这个模块；
 * - 用 globalThis 上的键兜住 Vite HMR 或重复 import，避免出现第二个 Audio。
 *
 * 播放策略：
 * - 首次访问默认开启，尝试自动播放；被浏览器拒绝时静默等待第一次用户交互；
 * - 每轮把 12 首打乱后逐个抽完，轮与轮之间不会紧接着重复上一首；
 * - 播放结束、加载失败都只走一个入口，失败曲目会跳过，不会卡住整个列表；
 * - 用户开关写入 localStorage，下一次访问沿用选择。
 */

const STORAGE_KEY = 'foodsoul.music.enabled';
const DEFAULT_VOLUME = 0.28;
const GLOBAL_KEY = '__FOOD_SOUL_MUSIC_PLAYER__';
const BASE_URL = (import.meta.env?.BASE_URL || '/').replace(/\/?$/, '/');

const ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M9 18V5l10-2v13"></path>
    <circle cx="6" cy="18" r="3"></circle>
    <circle cx="16" cy="16" r="3"></circle>
  </svg>
`;

const trackUrl = (file) => `${BASE_URL}music/${file}`;

function readEnabled() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

function saveEnabled(enabled) {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // 隐私模式可能禁用 localStorage：本次会话仍可正常播放，只是不持久化
  }
}

function shuffled(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function initMusic(root) {
  const mount = root || document.getElementById('music-root') || document.body;
  if (!mount) return null;

  const existing = globalThis[GLOBAL_KEY];
  if (existing) {
    // HMR / 重复调用时复用原来的播放器和按钮，绝不新建第二个 Audio。
    if (existing.el && !mount.contains(existing.el)) mount.append(existing.el);
    return existing;
  }

  const player = createMusicPlayer(mount);
  globalThis[GLOBAL_KEY] = player;
  return player;
}

function createMusicPlayer(mount) {
  const audio = new Audio();
  audio.preload = 'auto';
  audio.volume = DEFAULT_VOLUME;
  audio.loop = false;
  audio.hidden = true;
  audio.className = 'music-audio';
  audio.setAttribute('aria-hidden', 'true');

  const disc = h(
    'span',
    { class: 'music-toggle__disc', 'aria-hidden': 'true' },
    h('span', { class: 'music-toggle__icon', html: ICON })
  );

  const button = h(
    'button',
    {
      class: 'music-toggle',
      type: 'button',
      'aria-label': '播放背景音乐',
      'aria-pressed': 'false',
      title: '背景音乐',
    },
    h('span', { class: 'music-toggle__halo', 'aria-hidden': 'true' }),
    disc,
    h('span', { class: 'sr-only', text: '背景音乐' })
  );

  const wrap = h('div', { class: 'music-toggle-wrap', 'data-music-ui': 'button' }, button, audio);
  mount.append(wrap);

  let enabled = readEnabled();
  let currentIndex = -1;
  let pool = shuffled(MUSIC_TRACKS.map((_, index) => index));
  let failed = new Set();
  let playing = false;
  let blocked = false;
  let disposed = false;
  let attempt = 0;
  let unlockArmed = false;
  let lastUnlockAttempt = 0;

  const unlockEvents = ['pointerdown', 'click', 'keydown'];

  function currentTrack() {
    return currentIndex >= 0 ? MUSIC_TRACKS[currentIndex] : null;
  }

  function updateUI() {
    const track = currentTrack();
    button.classList.toggle('is-playing', playing);
    button.classList.toggle('is-blocked', blocked && enabled && !playing);
    button.classList.toggle('is-off', !enabled);
    button.dataset.playing = playing ? '1' : '0';
    button.dataset.blocked = blocked ? '1' : '0';
    button.dataset.enabled = enabled ? '1' : '0';
    button.dataset.trackCount = String(MUSIC_TRACKS.length);
    button.setAttribute('aria-pressed', String(playing));
    button.setAttribute('aria-label', playing ? '暂停背景音乐' : enabled ? '播放背景音乐' : '开启背景音乐');

    if (track) {
      button.dataset.track = String(currentIndex + 1);
      button.dataset.trackTitle = track.title;
      button.dataset.trackFile = track.file;
      button.title = playing
        ? `背景音乐 · ${track.title}（点击暂停）`
        : `背景音乐 · ${track.title}（点击播放）`;
    } else {
      delete button.dataset.track;
      delete button.dataset.trackTitle;
      delete button.dataset.trackFile;
      button.title = enabled ? '背景音乐（点击播放）' : '背景音乐已关闭（点击开启）';
    }

    if (mount.dataset) {
      mount.dataset.musicState = playing ? 'playing' : blocked ? 'blocked' : enabled ? 'paused' : 'off';
      mount.dataset.musicTrack = track ? String(currentIndex + 1) : '';
      mount.dataset.musicTrackTitle = track ? track.title : '';
      mount.dataset.musicTrackCount = String(MUSIC_TRACKS.length);
    }
  }

  function disarmUnlock() {
    if (!unlockArmed) return;
    unlockArmed = false;
    for (const type of unlockEvents) {
      document.removeEventListener(type, onFirstGesture, true);
    }
  }

  function armUnlock() {
    if (unlockArmed || disposed) return;
    unlockArmed = true;
    for (const type of unlockEvents) {
      document.addEventListener(type, onFirstGesture, true);
    }
  }

  function onFirstGesture(event) {
    if (disposed || !enabled || playing) return;
    // 点击按钮本身交给 click 处理器决定开关，避免“先自动恢复又被按钮暂停”。
    if (event.target instanceof Element && event.target.closest('.music-toggle')) return;

    const now = Date.now();
    if (now - lastUnlockAttempt < 600) return;
    lastUnlockAttempt = now;
    resumeCurrentOrNext();
  }

  function setPlaying(next) {
    playing = next;
    if (next) {
      blocked = false;
      failed.delete(currentIndex);
      disarmUnlock();
    }
    updateUI();
  }

  function refillPool(avoid) {
    const available = MUSIC_TRACKS.map((_, index) => index).filter(
      (index) => !failed.has(index) && index !== avoid
    );
    pool = shuffled(available);
  }

  function pickNext(avoid = -1) {
    if (!pool.length) refillPool(avoid);
    if (!pool.length) return -1;

    let position = pool.findIndex((index) => index !== avoid);
    if (position < 0) position = 0;
    return pool.splice(position, 1)[0];
  }

  function failTrack(index) {
    if (disposed || !enabled || index < 0 || index === undefined) return;
    if (currentIndex !== index) return;
    if (failed.has(index)) return;

    failed.add(index);
    playing = false;
    blocked = false;
    updateUI();

    const next = pickNext(index);
    if (next < 0) {
      // 12 首都失败时停止尝试，但保留 enabled；用户再次点击会重新清空失败集重试。
      return;
    }

    window.setTimeout(() => {
      if (!disposed && enabled && currentIndex === index) {
        void loadTrack(next);
      }
    }, 60);
  }

  async function loadTrack(index) {
    if (disposed || !enabled || index < 0) return;
    const track = MUSIC_TRACKS[index];
    if (!track) return;

    currentIndex = index;
    const token = (attempt += 1);
    audio.src = trackUrl(track.file);
    audio.load();
    blocked = false;
    updateUI();

    try {
      await audio.play();
    } catch (error) {
      handlePlayError(error, token, index);
    }
  }

  function handlePlayError(error, token, index) {
    if (disposed || token !== attempt) return;
    if (error?.name === 'AbortError') return;
    if (error?.name === 'NotAllowedError') {
      blocked = true;
      armUnlock();
      updateUI();
      return;
    }
    failTrack(index);
  }

  function playCurrent() {
    if (disposed || !enabled) return;
    if (!audio.currentSrc || audio.error || currentIndex < 0 || audio.ended) {
      startNext(currentIndex);
      return;
    }

    const token = (attempt += 1);
    blocked = false;
    updateUI();
    audio.play().catch((error) => handlePlayError(error, token, currentIndex));
  }

  function startNext(avoid = currentIndex) {
    if (disposed || !enabled) return;
    const next = pickNext(avoid);
    if (next < 0) {
      blocked = false;
      updateUI();
      return;
    }
    void loadTrack(next);
  }

  function resumeCurrentOrNext() {
    if (!enabled) return;
    playCurrent();
  }

  function disable() {
    enabled = false;
    blocked = false;
    playing = false;
    attempt += 1;
    saveEnabled(false);
    disarmUnlock();
    audio.pause();
    updateUI();
  }

  function enable() {
    enabled = true;
    blocked = false;
    // 用户主动恢复时允许重新尝试之前失败的曲目。
    failed = new Set();
    pool = [];
    saveEnabled(true);
    updateUI();
    resumeCurrentOrNext();
  }

  function toggle() {
    if (playing) disable();
    else enable();
  }

  // 结束事件只注册一次，避免一次播放结束触发多次切歌。
  audio.addEventListener('ended', () => {
    if (disposed) return;
    playing = false;
    updateUI();
    if (enabled) startNext(currentIndex);
  });

  audio.addEventListener('playing', () => {
    if (disposed) return;
    // 用户刚好在 play() 返回前关闭时，不要再把按钮点亮。
    if (!enabled) {
      audio.pause();
      return;
    }
    setPlaying(true);
  });

  audio.addEventListener('pause', () => {
    if (disposed) return;
    if (playing) {
      playing = false;
      updateUI();
    }
  });

  audio.addEventListener('error', () => {
    if (disposed || !enabled || currentIndex < 0) return;
    failTrack(currentIndex);
  });

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggle();
  });

  updateUI();
  if (enabled) startNext(-1);

  return {
    el: wrap,
    audio,
    state: () => ({
      enabled,
      playing,
      blocked,
      track: currentIndex + 1,
      title: currentTrack()?.title || '',
      file: currentTrack()?.file || '',
      failed: failed.size,
      tracks: MUSIC_TRACKS.length,
    }),
    destroy() {
      if (disposed) return;
      disposed = true;
      disarmUnlock();
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      button.remove();
      audio.remove();
      wrap.remove();
      if (globalThis[GLOBAL_KEY]?.el === wrap) delete globalThis[GLOBAL_KEY];
    },
  };
}