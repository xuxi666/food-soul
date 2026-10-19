# 食有灵 · FOOD SOUL 2.0 — 项目交接文档

> 生成时间：接手完成时（AI 助手首次全量接管）。本文件为项目事实快照，后续开发请据此维护更新。

## 1. 项目定位

**食有灵 · FOOD SOUL** —— 中国美食 × GLM 互动网站（package name `food-soul` v1.0.0）。
以「味型即人格」为核心创意：每道菜对应一种口味人格，可以用 AI 以菜品第一人称聊天、生成菜谱、按条件推荐菜品；首页是 Three.js 3D 环形画廊（八大菜系 / 八种口味双模式）。

技术栈：**原生 JS（无框架）SPA + Vite 5 + Three.js r160 + 自研 node:http 后端（无 Express）+ zod 校验 + playwright-core 无头 QA**。

## 2. 目录与仓库关系（重要）

- `F:\AIweb\美食1.0`（上级目录）是一个 **git 仓库**，内容是 1.0 React/TS 版（`src/App.tsx`、`server/api.ts`、92 道菜品库 `src/data/dishes/*.ts`），当前有未提交改动。
- `aimeishi2.0` 是上级仓库 **gitignore 的子目录，自身没有 .git** —— 即本项目 2.0 **没有任何版本控制**（风险点 ①）。
- `ref-shiyouling` 是另一独立 git 仓库（参考项目）。
- `scripts/import-dishes.mjs` 是「从 1.0 参考库迁移 92 道菜 → 2.0」的脚本（生成 `src/data/dishes/library.js` + 复制照片），**未执行完成**：`library.js` 不存在，`dishes.js` 仍是独立 16 道菜（风险点 ②）。`public/dishes/` 里 97 张 jpg = 16 张 2.0 菜品图 + 81 张 1.0 迁移残留图。

## 3. 运行方式

| 场景 | 命令 | 说明 |
| --- | --- | --- |
| 开发 | `npm run dev` | Vite，0.0.0.0:5180（strictPort），`/api/*` 经 vite 插件转发到 `server/api.mjs` |
| 生产 | `npm run build && npm start` | `server/index.mjs` 静态服务 `dist/`（127.0.0.1:5190），SPA 回退 + `/api/*` |

环境变量（`.env`，gitignored）：`GLM_API_KEY=<在此填入你自己的 Key>`、`GLM_MODEL=glm-4-flash`、`GLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4`、`PORT=5190`。无密钥时自动进入 **演示模式（demo）**：全部 AI 回复由 `server/demo.mjs` 本地模板引擎产出，导航栏显示「演示模式」徽标。

## 4. 前端结构

```
src/main.js               入口：4 个 CSS + initRouter(#view) + mountMascot(#mascot-root) + health 徽标
src/router.js             hash 路由 + circularReveal 圆形转场（mountInto/adopt/renderToken）
src/lib/api.js            guest 身份（localStorage 'foodsoul.guest.v1'）、全部 REST、chatStream(SSE)
src/lib/dom.js            h()/qs()/clear()/swap()/toast()/fmtTime()
src/lib/transition.js     circularReveal 圆揭示转场 + 路由预览系统
src/gallery.js            Three.js 环形画廊引擎（buildRing、缩放/惯性/滚轮/激活/调试接口）
src/components/mascot.js  全局右下角小精灵（5 个随机 SVG：包子/饺子/汤圆/糖葫芦/小辣椒）
src/components/comments.js 菜品评论区（嵌套回复 + AI 回复 + 举报/删除）
src/data/dishes.js        16 道菜（独立数据源）；DISH_BY_ID / dishesByCuisine / dishesByTaste / primaryTaste
src/data/cuisines.js      八大菜系 + 八种味型（CUISINE_BY_ID / TASTE_BY_ID）
src/data/personalities.js 8 种味型人格（name/archetype/flavor/language/emotion/rhythm/metaphors/avoid/rules/greeting/samples）+ PROBE_QUESTIONS
src/data/wheel.js         首页转环节点构建器（cuisine/taste 双模式）
src/styles/               base(主题令牌)/home(转环)/app(通用)/community 四个 CSS
```

### 路由与视图（hash 路由）

| 路由 | 视图 | 功能 |
| --- | --- | --- |
| `/` | home | 3D 环形画廊（记住上次模式；WebGL 失败降级网格；环形转场预览） |
| `/cuisines/:id` `/tastes/:id` | category | 菜系/味型详情：cat-hero + 人格卡 + dishCard 网格 |
| `/chat/:id` | chat | 与菜品 AI 聊天（SSE 流式、快捷提问、重新生成、复制、评论区） |
| `/recipe` | recipe | AI 生成菜谱（zod 校验、份数缩放、勾选、复制纯文本、再生成） |
| `/recommend` | recommend | 按口味/预算/人数/忌口推荐 3 道菜（条件过窄自动放宽并提示） |
| `/dishes` | dishes | 全部菜图鉴（菜系/口味筛选 + 搜索） |
| `/explore` | explore | 长页介绍：图鉴、AI 能力三卡片、人格问答(probe)、生成/推荐入口 |
| `/community` | community | 访客发帖（≤800 字、可附图≤3MB）、点赞、评论、「让菜回应」、举报/删除、分页 |
| 其他 | notfound | 404「这道菜不在菜单上。」 |

## 5. 后端 API（server/api.mjs 统一分发）

| 端点 | 说明 |
| --- | --- |
| `GET /api/health` | {ok, demo, model, 菜品数, 评论统计, 社区统计} |
| `GET /api/greeting?dishId` | 菜品人格欢迎语 |
| `GET /api/probe?personaId&q` | 人格问答（恒为 demo 引擎） |
| `POST /api/chat` | 模式 dish/mascot；SSE 事件 meta/delta/done/error；demo 引擎逐 3 字 26ms 输出 |
| `POST /api/recipe` | {dishId|dishName, servings 1-12, difficulty, ingredients≤200, maxMinutes, taste}；GLM 两次尝试（temp .5→.2）失败则回退 demo |
| `POST /api/recommend` | 忌口词表过滤（辣/海鲜/猪肉/牛肉/蛋/坚果/酒/素）→ 8 候选 → GLM 选 3 附理由 |
| `GET/POST /api/posts` `…/:id/like|report|comments|ai-reply` | 社区帖子（排序 latest/hot/discussed、分页、图片上传） |
| `GET/POST /api/comments` `…/:id/like|report|ai-reply` | 菜品评论（嵌套、AI 回复、owner 删除） |
| `POST /api/upload` | 图片 dataURL（jpeg/png/webp/gif ≤3MB）→ `public/uploads/{uuid}.{ext}` |

服务端复用前端 `src/data/dishes.js`；请求统一挂 `x-guest-id`/`x-guest-name` 访客身份头。
持久化：`data/comments.json`、`data/community.json`（gitignored，首启播种 3 条评论 + 3 条官方帖子）。

## 6. 关键机制备忘

- **AI 聊天链路**：`chatStream` → `POST /api/chat` → `handleChat` 开 SSE → demo（`demoReply`/`demoMascotReply`）或 live（`streamGLM` + `buildDishSystemPrompt`/`buildMascotSystemPrompt` 第一人称人格提示词）。
- **菜谱链路**：`validateRecipe`（zod schema：食材 1-30、步骤 1-30、难度/火候枚举等）→ `normalizeRecipe` 宽松修复 → 合法才返回，否则 fallback demo。
- **转场系统**：`circularReveal({origin, accent, render, commit})` —— 先在新页面画布上以圆形遮罩播放缩放预览，`commit` 时 `adopt` 把舞台 DOM 搬进 `#view` 并推 history；`abortReveal` 可取消（用于连续旋转）。
- **演示模式**：`CONFIG.isDemoMode()`（无 GLM key），全站 AI 能力不依赖网络可用。

## 7. QA 与脚本

- `scripts/`：约 26 个 playwright-core 无头脚本（`verify.mjs`、`smoke.mjs`、`qa*.mjs`、`shot*.mjs`、`measure*.mjs`、`probe*.mjs`、`import-dishes.mjs`、`board/*` 等），产出 `shots/` 截图；`verify.mjs` 依赖 `window.__exhibition.gallery` 调试钩子（home.js 挂载）。
- 字体：`public/fonts/inter-{200,300,400,500}.woff2`。

## 8. 已知风险/待办（接手时发现）

1. **无版本控制**：aimeishi2.0 没有自己的 .git，被上级仓库忽略 —— 建议 `git init`。
2. **菜品库迁移未完成**：import-dishes.mjs 可用但未落地（92 道菜未合并进来，81 张残留图待清理）。
3. **生产环境上传图 404**：`/api/upload` 写 `public/uploads/`，但生产只静态服务 `dist/`，上传图片在生产可能加载失败。
4. 上级 1.0 仓库有未提交改动（App.tsx、api.ts、社区组件等），与本项目互不影响但需留意。
5. 首页转环在无 WebGL 时降级为普通网格（已处理，非缺陷）。
