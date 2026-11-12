# 寻味推荐 / AI FOOD CURATION

## 模块位置

- 路由：`/recommendations`
- 书签：目录 → 图鉴 → **推荐** → 菜系 → 口味 → 菜谱 → 厨房 → 社区
- 章节号：`02`，目录页码 `06–07`
- 进入方式：目录「寻味推荐」、书签「推荐」、直接访问 `/recommendations`
- 复用现有翻页动画；没有另造路由或页面切换器。

## 页面结构

桌面端是左右两个独立滚动区：

- 左页 `.rec-form-pane`：需求表单。
- 右页 `.rec-result-pane`：初始欢迎 / 加载 / 结果 / 错误状态。
- 两页在书脊处分开，互不覆盖；移动端和窄屏由现有 `bk-stage.is-single` 单页模式切换「表单 ↔ 结果」。

左页区块：

1. 今天的心情（多选）
2. 想吃的口味（多选，复用 `src/data/cuisines.js` 的 `TASTES`）
3. 人均食材预算（单选，按图鉴参考价 ÷ 份量估算）
4. 更多条件（人数、场景、时长、难度、做法、饮食限制、忌口食材）
5. 再说一句（自由描述，300 字）
6. 主按钮「✦ 为我寻味」

右页初始状态只显示欢迎语和 5 个快速开始，不预先渲染任何固定菜品。快速开始只填左页，不直接发请求。

## 后端流程

```text
normalizeConditions
  → 自由描述解析（人数/总预算/人均预算/时长/难度/忌口/现有食材/心情线索）
  → candidatePool：对真实 DISHES 做确定性硬过滤
  → scoreDish：心情/口味/场景/人数/预算/时长/做法/饮食/自由描述打分
  → limitCandidates（最多 32 道）
  → GLM / DeepSeek 只从候选 dishId 中选 1 道首选 + 4–6 道推荐并写理由
  → Zod 校验 → 服务端复核 ID、重复、忌口、预算、时长、菜名、健康结论
  → buildResponse（条件 chips、why、notes、generation）
```

硬过滤：

- 口味、预算、时长、难度、做法
- 不吃辣（味型 + 标签 + 配料关键词，保守）
- 素食/纯素（基于菜品档案配料字段，页面明确标注未逐项核验）
- 忌口食材（支持海鲜、肉、牛肉、猪肉、鸡肉、羊肉、花生、坚果、香菜、鸡蛋、乳制品、麸质等组）
- 换一批排除已看过的 dishId；同时按菜名排除图鉴里的同名重复记录

AI 只做「候选内选择 + 理由」，不能引入图鉴外菜品。模型输出不合法会重试一次，仍失败返回 `ai_output_invalid`，不会拼凑假菜。

理由额外做服务端清洗：不得提及其他菜名、不得出现营养/健康/医疗结论、不得出现金额或精确成本（例如「人均食材成本 14 元」）；命中后回退为服务端事实理由。预算区间只出现在条件 chip 和摘要里，人均金额只在卡片 metadata 里以「约 ¥N/人」出现。

## API

### `POST /api/recommendations/generate`

请求示例：

```json
{
  "mood": ["heal"],
  "flavors": ["qingxian"],
  "budget": "20to50",
  "peopleCount": "1",
  "diningScenario": "solo",
  "timeLimit": "30",
  "difficulty": "easy",
  "cookingMethods": ["煮"],
  "dietaryRestrictions": ["nospicy"],
  "excludedIngredients": ["香菜"],
  "freeText": "今天有点累，家里有鸡蛋和番茄"
}
```

字段说明：

- `mood`：`treat | tired | heal | happy | appetite | new | indecisive | reward`
- `flavors`：`mala | xiangla | suanla | qingxian | xianxian | xiantian | jiangxiang | chunhou`
- `budget`：`under20 | 20to50 | 50to100 | over100 | unlimited`
- `peopleCount`：`1 | 2 | 3-4 | 5+`
- `diningScenario`：`solo | family | friends | couple | banquet | home`
- `timeLimit`：`15 | 30 | 60`
- `difficulty`：`easy | medium | hard`
- `cookingMethods`：`炒 炖 煮 蒸 炸 烤 煎 焖 凉拌`
- `dietaryRestrictions`：`vegetarian | vegan | nospicy | lowoil | lowsugar | lowsalt`
- `excludedIngredients`：字符串数组或逗号分隔字符串
- `freeText`：最多 300 字

响应主要字段：

- `recommendationId`
- `summary`（AI 动态摘要，或服务端事实摘要）
- `usedConditions[]`：`{ key, label, value }`
- `topPick`：完整菜品卡片（真实字段、`reason`、`matchTags`、`why`、`estimatedCost`）
- `recommendations[]`：其余 0–6 道
- `generation`：`provider`、`model`、`candidateCount`、`excludedCount`、`mode`
- `notes[]`：成本、时长、素食/不吃辣口径
- `batchIndex`、`generatedAt`

### `POST /api/recommendations/refresh`

同一套条件，额外传：

```json
{
  "batchIndex": 1,
  "excludedDishIds": ["dazhu-gansi", "bai-qie-ji"]
}
```

服务端按 ID + 菜名排除；没有新候选时返回 `409 exhausted`，不会重复上一批。

### `POST /api/recommendations/feedback`

```json
{
  "recommendationId": "rec-...",
  "batchIndex": 0,
  "dishId": "dazhu-gansi",
  "feedbackType": "dislike"
}
```

只写轻量反馈表 `recommendation_feedback`，不删除菜品，不保存自由描述。匿名请求 `user_id = null`；登录用户会关联用户 ID。

错误码：

- `400 empty_conditions`
- `409 no_candidates` / `exhausted`
- `429 rate_limited`
- `500 recommendation_failed`
- `500 ai_output_invalid` / `ai_failed` / `network` / `timeout`

## 数据口径

- 菜品：`src/data/dishes.js`，97 条，全部有 `price`、`servings`、`prep`、`cook`、`difficulty`、`ingredients`、`tastes`。
- 成本：`price / servings` 的估算，只用于筛选和展示；统一显示为「约 ¥N/人」，不会说成精确食材成本或餐厅售价。
- 时长：`prep + cook`；图鉴里部分菜把总时长放在 `prep`，`cook` 为 0，因此按和计算。
- 重复菜名：图鉴存在 11 组同名不同 ID 的记录（如水煮鱼、白切鸡、松鼠鳜鱼等）。推荐候选和换一批均按菜名去重，避免同一道菜以两个 ID 出现；不改动原始图鉴数据。

## 结果页交互

- 首选：`AI 首选` + `glm-4-flash` 标识 + 具体理由 + 图片 + 难度/时长/人均估算/份量
- 其他 0–6 道：`AI 推荐` + 理由 + 标签
- 条件 chips：心情、口味、预算、人数、场景、时长、难度、做法、饮食、忌口、手边食材
- 「为什么推荐给我？」：展开服务端生成的图鉴事实、味型匹配、心情/场景、预算、现有食材、饮食限制口径
- 「换一批」：累计 `seen` + `disliked`，不重复
- 「不喜欢这道菜」：当前批次内立即移除并禁用，写入反馈表；换一批继续排除
- 调整方向：预算再低一点 / 换个口味 / 更简单快手 / 想点新鲜的 / 更符合心情；会改左页条件并重新生成
- 菜品详情、双页聊天、生成菜谱都复用现有模块：`/dishes/:id`、`openDishChat`、`navigateToRecipeModule`

## 验证记录

- 真实站点 AI：智谱 `glm-4-flash`，一次生成约 15–20 秒；接口 200。
- 场景 1：清淡治愈 + 清鲜本味 + 20–50 + 1 人 → 大煮干丝，5 道。
- 场景 2：想犒劳自己 + 麻辣/香辣 + 50–100 + 朋友小聚 → 剁椒鱼头、水煮鱼、宫保鸡丁等。
- 场景 3：15 分钟内 + 简单 + 20 元以内 → 仅 1 道候选（蒜蓉豆苗），页面如实显示 1 道，不补假菜。
- 场景 4：自由描述「累、鸡蛋/土豆/番茄、两个人、40 元、40 分钟」→ 识别出 2 人、总预算 40 元（≈20/人）、40 分钟、疲惫想暖胃、手边食材。
- 场景 5：不吃辣 + 香菜 + 50–100 + 2 人 → 结果无辣味型、无香菜。
- 换一批：上一批 5 个 ID + 同名菜名排除，结果无重名/重复 ID。
- 理由清洗：模型曾输出「人均食材成本 18 元 / 14 元」，已被服务端回退为不含金额的事实理由；最终结果理由无金额、无健康结论。
- 最终回归（当前代码）：疲惫想暖胃 + 清鲜本味 + 20–50 元 + 1 人 → 片儿川 / 白切鸡 / 福建鱼丸 / 福州线面 / 奶汤蒲菜，共 5 道；理由为具体菜名与味型，预算只写「预算内」；桌面 / 平板 / 手机均无 body 横向溢出。
- 不喜欢：接口 200，数据库 `recommendation_feedback` 有记录；当前卡片显示「已记录，不再推荐」。
- 空候选：100 元以上档返回 `409 no_candidates`，提示当前图鉴最高人均参考约 ¥94，建议改 50–100 元。
- 构建：`npm.cmd run build` 退出码 0；只有项目原有的 dynamic/static import 警告。
- 响应式：1440×900、1366×768、1024×768、820×1180、390×844 均无 body 横向溢出；桌面左右面板 `scrollHeight` 独立。
- 移动端：提交后先切到加载面，结果出来后显示「← 修改条件」；错误状态同样可返回表单。

## 已知限制

- AI 生成需要 15–20 秒；没有做流式逐字返回，加载页会给出真实阶段文案。
- 素食/纯素、不吃辣是保守启发式过滤，基于图鉴字段，不保证餐厅实际做法；页面有明确说明。
- 匿名用户的不喜欢记录无法跨设备关联；当前会话内和换一批立即生效。
- 图鉴同名重复数据在原数据层仍然存在，本模块只在推荐候选层去重，没有改动图鉴本身。
- 100 元以上档当前无候选是真实数据结果，不是接口故障。
- 本次没有 Git commit、没有 push、没有部署到线上；生产环境仍是原有版本。