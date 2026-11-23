import fs from 'node:fs';
import path from 'node:path';

// 轻量 .env 读取，避免额外依赖
function loadEnv() {
  const file = path.join(process.cwd(), '.env');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

/**
 * 联网检索服务（与用户自己的大模型分开）
 * ------------------------------------------------------------
 * 当前源码实际使用的检索链路是：自建 SearXNG → 360 搜索 → Bing RSS。
 * 不再读取旧版的 SEARCH_PROVIDER / SEARCH_API_KEY / SEARCH_BASE_URL；
 * 这三个字段仅保留在旧 .env 中也不会影响运行。
 *
 * 三个来源都允许用空串显式关闭；360 / Bing 有公开默认地址，
 * 因此通常不需要额外配置就能工作。isSearchConfigured() 必须与
 * web-search.mjs 的真实链路保持一致，不能再用旧版的 API Key 判定。
 */
const envUrl = (name, fallback = '') => {
  const raw = process.env[name] === undefined ? fallback : process.env[name];
  return String(raw || '').trim().replace(/\/+$/, '');
};

/** 每次调用时读取，便于测试和运行时诊断与本进程环境保持一致。 */
export function getSearchConfig() {
  return {
    searxngUrl: envUrl('SEARXNG_URL', ''),
    so360Url: envUrl('SO360_URL', 'https://www.so.com/s'),
    bingRssUrl: envUrl('BING_RSS_URL', 'https://cn.bing.com/search'),
  };
}

/** 兼容旧引用；实际判定请使用 getSearchConfig() / isSearchConfigured()。 */
export const SEARCH_CONFIG = getSearchConfig();

export const isSearchConfigured = () => {
  const cfg = getSearchConfig();
  return Boolean(cfg.searxngUrl || cfg.so360Url || cfg.bingRssUrl);
};

/** 未配置时给前端/日志的准确环境变量名。 */
export const searchConfigNeeded = () => {
  const cfg = getSearchConfig();
  return [
    !cfg.searxngUrl ? 'SEARXNG_URL' : '',
    !cfg.so360Url ? 'SO360_URL' : '',
    !cfg.bingRssUrl ? 'BING_RSS_URL' : '',
  ].filter(Boolean);
};

export const SERVER_CONFIG = {
  port: Number(process.env.PORT) || 5190,
  sessionTtlDays: Math.max(1, Math.min(30, Number(process.env.SESSION_TTL_DAYS) || 7)),
};
