# 营养分析功能说明

## 范围

本功能只做营养信息，不包含 AI 美食图片生成，也不接入 Gemini、Imagen 等图片服务。

四个入口共用同一套营养分析服务和数据结构：

| 入口 | 文件 | 展示方式 |
| --- | --- | --- |
| 厨房 | `src/views/kitchen.js` | 生成结果中的独立营养卡 |
| AI 推荐 | `src/views/recommendations.js` | 卡片摘要 + 详情弹层完整卡 |
| 菜谱 | `src/views/recipe.js` | 菜谱下方独立营养卡；用量可点击修改 |
| 菜品详情 | `src/book/dish-page.js` | 主要食材区下方的折叠入口 |

前端组件统一为 `src/components/nutrition-card.js`，接口封装在 `src/lib/nutrition.js`，服务端只有一个 `POST /api/nutrition/analyze`。

## 数据来源

- 主数据：中国食物营养成分查询平台，中国疾病预防控制中心营养与健康所，<https://nlc.chinanutri.cn/fq/>
- 本地缓存：`data/nutrition/foods.json`
- 数据版本：`2026-11-13`
- 当前收录：15 个常用食材分类，共 1,010 条
- 每条记录保留：食物名称、分类、可食部、来源链接、每 100 克能量/蛋白质/脂肪/碳水化合物/膳食纤维/钠/胆固醇等字段

平台页面没有公开的正式 API 合约，本功能只缓存常用食材的查询结果并在界面标注来源，不重新分发完整数据库，也不在运行时抓取外网。后续如平台条款变化，应重新确认使用方式。

### 缺失值

源数据中的 `—`、`Tr`、空值一律保存为 `null`，不默认成 `0`；界面显示「暂无数据」。

当前平台没有完整的「总糖」字段；「饱和脂肪」是百分比字段而不是克数，因此这两项暂不写入数值。缺少它们不会被当作 `0`，也不会把每道菜都标成「数据不完整」：核心项（能量、蛋白质、脂肪、碳水化合物、钠）齐全且食材匹配完整时仍显示「数据库计算」。

## 计算方式

`server/nutrition-service.mjs` 做确定性计算，不调用大模型生成数字：

1. 按别名和名称匹配本地食物；
2. 把克、千克、斤、两、毫升、茶匙、汤匙、杯、个等用量换算成克；体积换算使用密度；
3. 必要时按可食部调整；
4. 用每 100 克数据计算单项营养；
5. 汇总整道菜，再除以份数得到每份。

完全缺少用量时，可按食材类别的常见份量估算，并在结果中标记「估算值」。只有缺用量、个数/茶匙/汤匙换算、模板估算或可食部调整才会触发 `quantityEstimated`；毫升按密度换算是确定性换算，不因此把整道菜标成估算。

`server/nutrition-data.mjs` 只负责名称、单位、份量和可食部，不产生营养数字。

## 接口

### `POST /api/nutrition/analyze`

请求示例：

```json
{
  "dishName": "番茄炒蛋",
  "sourceModule": "recipe",
  "servings": 2,
  "allowTypicalPortions": true,
  "ingredients": [
    { "name": "番茄", "amount": 300, "unit": "g", "role": "main" },
    { "name": "鸡蛋", "amount": 150, "unit": "g", "role": "main" },
    { "name": "花生油", "amount": 15, "unit": "ml", "role": "aux" }
  ]
}
```

`sourceModule` 可为 `kitchen`、`recommendation`、`recipe`、`dish-detail`；`seasonings` 可作为可选字段传入。

响应中的 `nutrition` 包含：

- `total` / `perServing`：九项营养的整道与每份值；
- `dataType` / `dataLabel`：`calculated`（数据库计算）、`estimated`（估算值）、`partial`（数据不完整）、`insufficient`（暂无足够数据）；
- `completeness`：匹配食材数、总食材数、量化食材数、营养覆盖数、未匹配食材、缺失营养；
- `flags`、`assumptions`、`sources`、`sourceItems`。

### `GET /api/nutrition/status`

返回数据版本、食物条数、来源和可用营养素，用于排查配置。

## 缓存

`server/nutrition-cache.mjs` 使用内存 + `data/nutrition-cache.json`，默认 TTL 30 天，最多 1,000 条。

缓存键由以下内容归一化后计算 SHA-256：

- 菜品名称；
- 每种食材的名称、用量、单位、角色；
- 份数；
- 是否允许常见份量估算；
- 食物数据版本。

食材、用量或份数一旦修改，缓存键变化，会重新分析。服务端缓存只保存营养结果；响应增加 `cached` 标记。前端另有 10 分钟会话缓存。

## 失败处理

营养接口失败、超时或数据不足时：

- 菜谱、推荐、厨房结果和菜品详情照常显示；
- 营养卡显示中文错误提示与「重新分析」按钮；
- 不伪造数值，不把缺失项写成 `0`。

## 测试重点

- 厨房：生成结果自动出现营养卡；
- 菜谱：修改食材用量、调整份数后重新计算；
- AI 推荐：卡片摘要与详情完整卡；未知菜名只能得到估算/不完整/暂无足够数据；
- 菜品详情：折叠卡默认不占用画册版面，展开后再请求；
- 失败隔离、重试、PC/移动端网格与中文标签。

## 未完成项

- 总糖和饱和脂肪缺少可直接使用的公开数值，暂显示「暂无数据」；
- 尚未接入 USDA FoodData Central 作为补充数据源；
- 尚未做全量食材/全部菜谱的逐项人工核验。