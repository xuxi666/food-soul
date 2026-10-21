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
 * 菜谱的「真实来源检索」与图鉴的「AI 补全菜品」依赖独立的 Web Search API，
 * 不能把用户配置的聊天模型误当成具备联网搜索能力。
 * 可用 SEARCH_API_KEY 单独配置；未配置时相关功能会明确提示，不伪造来源。
 */
export const SEARCH_CONFIG = {
  /** zhipu（智谱 Web Search）| searxng（自建元搜索） */
  provider: (process.env.SEARCH_PROVIDER || 'zhipu').toLowerCase(),
  apiKey: process.env.SEARCH_API_KEY || '',
  baseUrl: (process.env.SEARCH_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, ''),
  /** 自建 SearXNG 的地址，例如 http://127.0.0.1:8080 */
  searxngUrl: (process.env.SEARXNG_URL || '').replace(/\/$/, ''),
};

export const isSearchConfigured = () =>
  SEARCH_CONFIG.provider === 'searxng' ? Boolean(SEARCH_CONFIG.searxngUrl) : Boolean(SEARCH_CONFIG.apiKey);

export const SERVER_CONFIG = {
  port: Number(process.env.PORT) || 5190,
  sessionTtlDays: Math.max(1, Math.min(30, Number(process.env.SESSION_TTL_DAYS) || 7)),
};
