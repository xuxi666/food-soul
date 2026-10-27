# 五类 UML 图的实现依据清单

> 项目：食有灵 FOOD SOUL（`F:\AIweb\美食1.0\aimeishi2.0`）
> 生成时间：2026-10-26　制图工具：PlantUML 1.2024.7（`skinparam monochrome true`，纯灰度、无彩色）
> 说明：下文行号对应生成时的源码版本，函数名与字段名可直接在仓库检索。

---

## 一、核实的业务事实

| # | 业务事实 | 结论 | 依据 |
|---|---|---|---|
| 1 | 游客能否使用 AI 功能 | 能，但前提是内置 AI 已启用（`site_ai.enabled = 1` 且存在已验证并启用的配置） | `server/site-ai.mjs` `resolveAIConfig()`:177、`isSiteAIUsable()`；`server/api.mjs` `resolveAIForRequest()`:132 |
| 2 | 哪些操作必须登录 | 发帖/评论/点赞/举报/上传图片、个人 AI 配置、`/api/ai/*` 全部接口 | `server/auth.mjs` `requireUser()`:95；`server/api.mjs` 各 `handlePosts`/`handleComments`/`handleUpload` 分支 |
| 3 | 哪些操作仅限管理员 | `/api/admin/*`：内置 AI 总开关与配置增删改测启、社区审核与举报处理、配图维护、审计日志 | `server/auth.mjs` `requireAdmin()`:105；`server/admin-routes.mjs`:385-490 |
| 4 | 内置 AI 是否有独立开关 | 有，`site_ai.enabled`（单行表，CHECK id = 1），关闭后 `resolveAIConfig` 回落个人配置或返回 `ai_disabled` | `server/db.mjs` site_ai 建表；`server/site-ai.mjs` `resolveAIConfig()` |
| 5 | 配置是否支持增/改/删/启用/切换 | 支持。最多 3 套配置；同一时刻仅一套 `enabled = 1`，由部分唯一索引保证；启用前必须通过连通性测试，且启用时会再真实测一次 | `server/db.mjs`:135 `idx_site_ai_profile_single_enabled`；`server/site-ai.mjs` `enableSiteProfile()`:418、`removeSiteProfile()`:451 |
| 6 | AI 聊天经过哪些步骤 | 同源校验 → 配置裁决（内置优先/个人兜底）→ 消息裁剪（最近 12 条、单条 1200 字符）→ 拼 system → `chatStream` → SSE 逐条下发 `meta/delta/done/error` | `server/api.mjs` `handleChat()`:282、`sse()`:99、`openSSE()`:90；`server/ai-adapter.mjs` `chatStream()`:141 |
| 7 | 菜谱生成是否调模型 | 分两步：`/api/recipe/lookup` 只查图鉴与联网检索（不调模型，游客可用，30 次/分）；`/api/recipe` 才调模型 | `server/api.mjs` `handleRecipeLookup()`:573、`handleRecipe()`:613 |
| 8 | 联网检索是否并行 | 是，SearXNG 与 Bing RSS 用 `Promise.all` 并发，再按 URL 去重、按菜名做相关性过滤 | `server/web-search.mjs`:292、`webSearchMany()`:349 |
| 9 | 菜谱输出如何保证结构 | 模型输出经 `validateRecipe()`（zod：字段类型、枚举、条数区间）后才返回，不通过则报错、不渲染 | `server/recipe-schema.mjs`:83 |
| 10 | 智能推荐是否由模型决定选菜 | 否。先用口味/预算/人数/忌口做词表过滤，模型只在候选池内排序并写理由 | `server/api.mjs` `handleRecommend()`:837 |
| 11 | 数据存在哪里 | 9 张 SQLite 表（账号、会话、AI 配置、内置 AI、配图、举报、审计）+ JSON 文件（帖子、菜品评论）+ `public/uploads/` + 前端静态档案 | `server/db.mjs`:19-150；`server/community.mjs`、`server/store.mjs` |
| 12 | 是否存在会话状态机/菜谱任务状态机 | 不存在。对话只在前端页面状态中，菜谱生成是单次请求-响应，无持久任务状态 | `src/views/chat.js`（无服务端会话表）；`server/api.mjs` `handleRecipe` 无任务表 |
| 13 | 是否存在配置状态字段 | 存在：`last_status`（`unverified`/`ok`/`error`/`failed`/`unavailable`）、`verified_at`、`enabled` | `server/db.mjs` 建表默认值；`server/ai-config.mjs`:221 `markAIConfigStatus()`；`server/site-ai.mjs`:317/383 |

---

## 二、五张图的场景、目的与依据

### 1. `01-use-case.puml` — 用例图

- **目的**：按真实权限划分参与者与用例，说明游客、登录用户、管理员各自能做什么。
- **参与者**：游客、登录用户、管理员。三者用 UML 泛化表示（`登录用户` 继承 `游客`，`管理员` 继承 `登录用户`），因为登录用户实际可做游客的全部操作。
- **用例来源**：路由表 `src/router.js` 与 `src/views/*.js`（浏览、图鉴、详情、对话、菜谱、推荐、视频、社区、后台）。
- **依据**：`server/auth.mjs` 的 `requireUser`/`requireAdmin`；`server/api.mjs` `resolveAIForRequest`。
- **未使用 include/extend**：源码中不存在“某用例必然触发另一用户可见用例”的结构，AI 配置裁决属于系统内部步骤，画成 include 会失真，故只用关联。
- **note 内容**：游客使用 AI 的前提条件（内置 AI 可用），来自 `site-ai.mjs`。

### 2. `02-sequence.puml` — 顺序图（AI 菜品对话）

- **场景**：用户在 `/chat/:id` 发送一条消息，到首字返回、流结束的完整链路。
- **参与者**：chat 页面、`api.mjs`、`site-ai.mjs`、SQLite、`prompt.mjs`、`ai-adapter.mjs`、模型服务。
- **组合片段**：
  - `opt`：同源校验失败返回 403（源码为 `if (!sameOrigin(req)) return send(res, 403, ...)`，单分支，用 opt 而非 alt）。
  - `alt`：内置可用 / 个人配置兜底 / 均不可用（三分支，对应 `resolveAIConfig` 的返回值）。
  - `loop`：每个流式增量。
  - `alt`：上游 401/429/5xx → `AIError` → `data:{"type":"error"}`；正常 → `data:{"type":"done"}`。
- **依据**：`handleChat` 中 `sse(res, {type:'meta'...})` 在 `chatStream` 之前发出，图中顺序与源码一致；消息裁剪 `slice(-12)`、`slice(0,1200)` 同源码。
- **未画**：多轮对话的服务端存储（不存在，对话只在前端）、重试（未实现）。

### 3. `03-state.puml` — 状态图（内置 AI 配置）

- **选择理由**：项目中唯一具有明确状态字段与迁移逻辑的业务对象是 `site_ai_profiles`（`last_status` + `verified_at` + `enabled`）。会话与菜谱任务没有状态机，若强行绘制只能虚构，故不画。
- **状态与迁移依据**（全部来自 `server/site-ai.mjs`）：
  - `未验证`：新建配置时 `last_status='unverified'`、`verified_at=NULL`（`db.mjs` 默认值）。
  - `已验证`：测试成功写入 `last_status='ok'`、`verified_at=now`（`:317`、`:383`）。
  - `验证失败`：测试失败写 `last_status='error'` + `last_error`。
  - `已启用`：`enableSiteProfile()` 要求 `verified_at` 非空且 `last_status==='ok'`、`encryptionReady()` 为真，并在启用前**再测一次**；失败则清空 `verified_at` 回到失败态。
  - 删除：`removeSiteProfile()` 删除启用项时先停用，若总开关开着则同步关闭。
  - 唯一约束：`idx_site_ai_profile_single_enabled` 保证同时最多一套 `enabled=1`。
- **总开关**：`site_ai.enabled` 是独立布尔字段，不参与该状态机，仅以 note 说明其作用，避免虚构“总开关状态机”。

### 4. `04-activity.puml` — 活动图（结构化菜谱生成）

- **场景**：从用户填写条件到菜谱渲染的完整分支，是项目中分支最多的流程。
- **并行**：`fork/join` 对应 `web-search.mjs` 中 `Promise.all([bing, sx])` 的真实并发。
- **判断分支**：图鉴命中（library）／检索有结果（ai-search）／检索为空（ai-knowledge）／配置不可用（409）／调用失败（错误返回）／zod 校验不通过（不渲染）。每个分支都有对应代码。
- **依据**：`handleRecipeLookup`、`lookupDish`、`webSearchMany`、`validateRecipe`、`dataSource` 三处赋值（`:687`、`:747`）。

### 5. `05-relationship.puml` — 关系图（ER）

- **选择理由**：项目有真实 SQLite 表结构，按优先级选 ER 图，而不是把函数模块硬套成 UML 类。
- **9 张表**：`users`、`sessions`、`ai_configs`、`reports`、`site_ai`、`site_ai_profiles`、`card_images`、`dish_images`、`audit_log`，字段与约束逐条抄自 `server/db.mjs` 建表语句。
- **真实外键（实线）**：仅 2 条 —— `sessions.user_id`、`ai_configs.user_id`，均 `ON DELETE CASCADE`。
- **逻辑关联（虚线）**：`reports.reporter_id`、`audit_log.actor_id` 在库中**没有**外键约束；`site_ai` 与 `site_ai_profiles` 的“引用当前启用项”由应用层判断；`reports.post_id` 指向 JSON 文件中的帖子。这些均以虚线 + 文字标注，不冒充数据库约束。
- **非表存储**：以独立方框列出 `community.json`、`comments.json`、`public/uploads/`、`src/data/dishes.js`、`cuisines.js`，避免读者误以为存在对应表。

---

## 三、未纳入图中的内容及原因

| 内容 | 原因 |
|---|---|
| 会话状态机、菜谱任务状态机 | 源码中不存在会话表与任务表，菜谱为单次请求-响应 |
| 消息队列、缓存集群、微服务网关 | 项目未使用；`rate-limit.mjs` 是进程内内存桶，`web-search` 缓存是进程内 Map，不构成独立组件 |
| 第三方视频 API | 做菜视频读取站内 `videos.mjs` 条目，不调用外部接口 |
| 自动营养分析、热量计算 | 未实现，菜谱 schema 中无相关字段 |
| 管理后台的具体按钮流程 | 属于界面细节，画进活动图会淹没业务主线 |
| 前端组件内部状态（如 3D 画廊动画） | 与业务语义无关 |

---

## 四、五张图之间的一致性检查

| 检查项 | 结果 |
|---|---|
| 用例图“游客可用 AI”与顺序图配置裁决 | 一致：顺序图 alt 第一分支即内置可用，对应游客场景 |
| 用例图“仅管理员管理内置 AI”与状态图 | 一致：状态图的触发事件均为管理员操作（新增/测试/启用/删除） |
| 用例图“生成菜谱游客可用”与活动图 | 一致：活动图第一步 `/api/recipe/lookup` 明确标注不调模型、游客可用；`/api/recipe` 才做配置校验 |
| 状态图“启用需已验证”与活动图“配置不可用→409” | 一致：未验证/未启用时 `resolveAIConfig` 返回不可用，活动图对应分支 |
| 关系图“内置 AI 单套启用”与状态图唯一索引说明 | 一致：两处均引用 `idx_site_ai_profile_single_enabled` |
| 关系图“帖子存 JSON”与用例图“发帖/评论” | 一致：用例存在，但数据不在 SQLite 中，关系图已用虚线 + 文件方框标明 |
| 顺序图 SSE 帧格式与源码 | 一致：源码 `sse()` 输出 `data: {json}`，图中按 `data: {"type":"delta"}` 标注，未写成 `event: delta` |

---

## 五、文件清单

```text
docs/diagrams/
├── 01-use-case.puml / .svg / .png
├── 02-sequence.puml / .svg / .png
├── 03-state.puml / .svg / .png
├── 04-activity.puml / .svg / .png
├── 05-relationship.puml / .svg / .png
└── diagram-evidence.md
```

渲染命令（PlantUML 1.2024.7 + Java 21）：

```bash
java -jar plantuml.jar -tsvg -tpng -charset UTF-8 docs/diagrams/*.puml
```

所有图使用 `skinparam monochrome true`，实测 SVG 中不存在任何非灰度色值（R=G=B）。

---

## 六、补充：架构图与模块依赖图（黑白版，替换文档中的彩色版）

| 文件 | 内容 | 依据 |
|---|---|---|
| `06-architecture.puml` | 五层组件图：客户端 / 接入层 / 业务层 / 数据层 / 外部服务 | `server/index.mjs`（Nginx:80 → Node:5190）、`api.mjs`（sameOrigin、rate-limit）、`site-ai.mjs`（模型路由）、`ai-adapter.mjs`（协议适配）、`db.mjs`（SQLite WAL）、`web-search.mjs`（SearXNG + Bing RSS） |
| `07-modules.puml` | 后端模块依赖（请求入口 / 业务模块 / 内容与基础 / 外部服务） | `server/*.mjs` 的实际 import 关系 |

这两张图与 01–05 使用同一套 `skinparam monochrome`，SVG/PNG 均为灰度，无彩色。
