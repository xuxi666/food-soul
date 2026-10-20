/** OpenAI 兼容服务商预设：只含公开的 Base URL，不含任何密钥 */
export const PRESETS = [
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

export function presetOf(id) {
  return PRESETS.find((p) => p.id === id) || PRESETS[PRESETS.length - 1];
}
