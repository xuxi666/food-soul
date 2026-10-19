/** 模型常见 JSON 瑕疵修复：未加引号的字符串值、尾逗号、中文引号 */
export function repairJSON(text) {
  let t = String(text || '');
  t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  t = t.replace(/,\s*([}\]])/g, '$1');
  t = t.replace(/:\s*([^"{}\[\],\s][^,{}\[\]\n]*?)(\s*[,}\]])/g, (m, value, tail) => {
    const v = String(value).trim();
    if (/^(?:true|false|null|-?\d+(?:\.\d+)?)$/.test(v)) return m;
    return `: ${JSON.stringify(v)}${tail}`;
  });
  return t;
}

/** 从可能带 markdown 围栏的文本中提取 JSON */
export function extractJSON(text) {
  if (!text) return null;
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1] : String(text);
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const slice = source.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    try {
      return JSON.parse(repairJSON(slice));
    } catch {
      return null;
    }
  }
}
