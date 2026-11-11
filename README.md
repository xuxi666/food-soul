# 食有灵 · FOOD SOUL

> 中国美食 × 用户自接入 AI 大模型。画册式的中华美食站点：封面 → 序 → 目录 → 章节，菜系 / 味型双页聊天、菜品人格对话、结构化菜谱生成、真实来源检索、美食社区与后台管理。

[![Node](https://img.shields.io/badge/node-%E2%89%A522.5-339933)](https://nodejs.org/)
[![Vite](https://img.shields.io/badge/vite-5-646CFF)](https://vitejs.dev/)
[![License](https://img.shields.io/badge/license-MIT-blue)](#许可)

## 这是什么

一个以「中国菜」为主题的互动站点：整站是一本可以翻阅的画册，封面翻开是序言与目录，目录之后依次是八大菜系、八种味型、图鉴、菜谱、厨房、社区、视频等章节；菜系与味型章节用「左档案 / 中书脊 / 右聊天」的双页布局，每个菜品、菜系、味型都有自己的 AI 人格。

**关键设计：站点本身不内置任何模型密钥。** 每个用户登录后，在右上角「接入 AI」里填入自己的模型服务（任意 OpenAI 兼容接口），密钥经 AES-256-GCM 加密后存进服务端数据库，每次请求按当前登录用户解密使用。

## 功能

| 模块 | 说明 |
|---|---|
| 画册外壳 | 封面 / 序 / 目录 / 章节；双页纸面、书脊、侧边书签、页码，地址与书页顺序一致 |
| 翻页与返回 | 页脚翻页、章节书签、返回与「合上画册」分离，浏览器前进后退可用 |
| 双模式探索 | 八大菜系 / 八种味型各成一章，两套独立数据，切换不残留 |
| 菜品人格对话 | 每个菜品有独立人格提示词，SSE 流式输出，支持多轮上下文 |
| 对话延伸建议 | 每条回答结束后生成 1–3 条可点击的后续建议（不阻塞主回答） |
| 菜谱工作台 | 手动输入菜名 → 图鉴优先匹配 → 图鉴没有则**真实联网检索**并展示来源 |
| Epicure 厨房 | 外部 Epicure MCP 的风味图谱 / 食材库 / 配方设计；服务不可用时整块降级，不伪造结果 |
| 流体转场 | 菜品详情与页内跳转沿用圆形扩散转场，支持 `prefers-reduced-motion` |
| 响应式 | PC 双页、平板压缩导航、手机单页，功能不裁剪 |
| 美食社区 | 发帖、回复、点赞、图片上传、举报、删除自己的内容 |
| 管理后台 | `/admin` 内页：真实计数概览、内置 AI 与 Epicure 双服务状态、社区内容、图鉴、举报处理 |
| 账号体系 | 邮箱 + 密码，scrypt 哈希，HttpOnly Cookie 会话 |
| 用户级 AI 配置 | 服务商预设 / 自定义 Base URL / 模型 ID / 连接测试 / 密钥加密存储 |

### 最近更新

**2026-11-11 · 管理后台修复与功能恢复**

- 右页空白根因修复：入场动画误用全局 `.is-swapping`（`opacity:0`）且从不移除，改为 `is-entering` 并在动画结束后摘除
- 概览换掉壳子数据：六项真实库计数 + 内置 AI / Epicure 两个独立状态区 + 最近审计
- 新增 `service_health` 表与 `diagnoseEpicure()`：服务端真实握手并调用 `list_targets`，错误按 DNS / 隧道 / 超时 / 鉴权等分类
- 帖子补齐编辑正文与分类、隐藏、恢复、按状态/分类/时间/被举报筛选；举报处理支持处理说明写库
- 单页 / 平板 / 手机：纸面恢复滚动、导航与统计重排，`退出登录` 可达
- 验收记录与截图：[`docs/ADMIN-BACKEND.md`](docs/ADMIN-BACKEND.md)、[`docs/admin-shots/`](docs/admin-shots/)

## 技术栈

- **前端**：Vite 5 + 原生 ES Modules（无框架）
- **后端**：Node.js 原生 `http`，无 Express
- **数据库**：`node:sqlite`（Node ≥ 22.5 内置），单文件 `data/foodsoul.db`
- **加密**：`node:crypto` —— scrypt 密码哈希、AES-256-GCM 密钥加密
- **AI**：OpenAI 兼容 `/chat/completions`，SSE 流式
- **检索**：自建 SearXNG + Bing RSS 兜底（不依赖付费检索 API）
- **外部风味服务**：Epicure MCP（Streamable HTTP，JSON-RPC），可开关、可降级

## 快速开始

```bash
# 需要 Node >= 22.5（用了内置 node:sqlite）
node -v

npm install

# 生成配置
cp .env.example .env
node -e "console.log('AI_CONFIG_SECRET=' + require('crypto').randomBytes(32).toString('base64'))"
# 把输出的这一行写进 .env

npm run dev          # 开发：http://127.0.0.1:5180
```

打开页面后：

1. 右上角「登录 / 注册」建一个账号
2. 点「接入 AI」，选服务商（或自定义），填 Base URL、API Key、模型 ID
3. 点「测试连接」——**必须真实请求成功才能保存**
4. 保存后状态变成「已接入：模型名」，聊天/菜谱/推荐即可使用

### 生产运行

```bash
npm run build        # 产物在 dist/
npm start            # 静态托管 dist + /api，默认 127.0.0.1:5190
```

建议前面挂 Nginx 反代。SSE 需要关掉缓冲：

```nginx
location / {
    proxy_pass http://127.0.0.1:5190;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;      # 关键：否则流式输出会被攒着一起发
    proxy_read_timeout 300s;
    client_max_body_size 12m; # 社区图片上传
}
```

### 发布与同步（本地 → 服务器 → GitHub）

日常改完代码，一条命令完成「提交 + 部署 + GitHub 同步」：

```bash
npm run ship -- -m "feat: 这次改了什么"
```

- 服务器 `/opt/food-soul` 是仓库工作区，收到更新后自动 `npm ci`（按需）→ `npm run build` → `pm2 restart food-soul` → 健康检查
- 部署成功后服务器自动 `git push` 回 GitHub，保证线上与仓库一致
- `.env`、`data/`、`public/uploads/` 等运行时文件不会被覆盖

| 命令 | 作用 |
| --- | --- |
| `npm run ship -- -m "msg"` | 提交并发布 |
| `npm run deploy` | 发布当前 HEAD |
| `npm run deploy:status` | 查看服务器部署状态 |
| `npm run deploy:setup` | 首次接管服务器（幂等） |

首次配置（服务器信息、SSH 私钥、GitHub 部署密钥）与故障排查见 [`docs/DEPLOY.md`](docs/DEPLOY.md)。


## 管理后台

访问 `/admin`。入口按钮只对管理员显示，权限完全由服务端判定。

**授权方式**：在服务端 `.env` 配置白名单，命中邮箱的账号登录后自动成为管理员：

```bash
ADMIN_EMAILS=you@example.com,another@example.com
```

- 角色存在 `users.role`，由服务端按白名单同步；前端传入的任何 `role` / `userId` 都不被信任
- 移出白名单后，该账号下次请求即降级为普通用户
- 未登录访问管理接口返回 `401`，普通用户返回 `403`

**功能模块**（截至 2026-11-11，逐项状态见 [`docs/ADMIN-BACKEND.md`](docs/ADMIN-BACKEND.md)）：

| 模块 | 说明 |
|---|---|
| 后台概览 | 五项**真实库计数**（注册用户 / 帖子 / 待处理举报 / 已处理·驳回 / 图鉴菜品），另含启用模型与最近测试；内置 AI 与 Epicure 两个独立状态区；最近 12 条管理操作 |
| 社区内容 | 关键词、分类、时间、状态（正常 / 已隐藏）、只看被举报筛选；分页；详情；编辑正文与分类；隐藏、恢复、删除（均确认后写入并记审计） |
| 美食图鉴 | 按菜名搜索、按菜系筛选、详情（口味 / 难度 / 份量 / 主料 / 简介）、换图与恢复 |
| 内置 AI | 内置模型开关、当前配置、Key 掩码状态、真实连接测试入口 |
| 举报处理 | 待处理 / 处理中 / 已处理 / 驳回筛选；处理说明写库；「确认违规并删除内容」会同时结案同类待处理举报 |

**服务状态是探测出来的，不是猜的**：`GET /api/admin/service-health?probe=1` 会真实连接 Epicure（`listTools` + 调用 `list_targets`，整体 8 秒上限），结果写入 `service_health` 表，成功只更新上次成功时间、失败只更新上次失败时间。错误按 `dns / refused / timeout / tunnel / auth / rate-limit / http-5xx / http-4xx / network` 分类，Cloudflare 1033 一类归为「外部隧道异常」，不会被误报成 AI Key 问题。

**明确没有做的**（页面会直接说明，不放无效按钮）：

- 待审核帖子队列：帖子发布即公开，数据模型只有软删除，没有 pending 状态
- 菜品新建 / 删除 / 改分类：菜品来自静态数据源，后台只做图片覆盖
- 用户与角色管理、站点设置、独立审计日志页：尚未实现

**移动端**：单页模式下整页可滚动，导航改竖列、统计三列，`退出登录` 与全部功能都可达（1440 / 834 / 390 三档均有回归测试）。

菜品图片替换写入 `dish_images` 表，前端启动时通过 `GET /api/assets/overrides` 拉取并覆盖本地数据源，在菜系页与菜品详情页真实可见。

后台的「首页图片」模块（`card_images`，16 个菜系 / 口味卡位）已随旧首页转盘一起移除：现在没有前台消费面，继续保留入口只会产生无效操作，因此页签、接口与读取逻辑一并下线，数据库历史记录保留不删。


### 内置 AI（全站统一模型）

管理员可在「后台 → 内置 AI」管理**最多 3 套**服务配置（DeepSeek / 智谱 / 火山引擎 / 自定义 OpenAI 兼容），并一键控制全站开关。

| 状态 | 行为 |
|---|---|
| 总开关开启 + 有启用且已验证的配置 | 所有用户都用这套内置模型，无需自备 Key |
| 总开关关闭 | 用户各自使用「接入 AI」里的模型；没有个人配置则收到明确提示 |

**约束（全部由后端强制）**

- 最多 3 套：新增接口在事务内校验数量，超出返回 400
- 同一时刻最多 1 套启用：`site_ai_profiles` 上有部分唯一索引 + 切换走事务
- 启用前必须通过连接测试；改动 provider / Base URL / 模型 / Key 会作废旧验证状态
- Key 留空保存 = 保留原密钥；只有显式填写新 Key 才会替换
- 删除当前启用项：先停用，若总开关开着则一并关闭，避免「已开启但无可用服务」
- 全站开关与配置存 SQLite（`site_ai` 总开关 + `site_ai_profiles` 配置），刷新/重启后仍有效
- 每次 AI 请求实时读库，不做跨请求缓存，切换后下一个请求立即生效

**Key 安全**：AES-256-GCM 加密（密钥来自 `AI_CONFIG_SECRET`，与密文分开存放），列表接口只返回「已保存」状态，任何响应都不含密钥。

**接口**：`GET /api/admin/site-ai`、`POST /site-ai/master`、`POST /site-ai/profiles`、`POST|DELETE /site-ai/profiles/:id`、`POST /site-ai/profiles/:id/test`、`POST /site-ai/profiles/:id/enable`

**迁移**：旧版单套配置（`site_ai` 单行）在启动时自动转成第一套配置，保留原密文与验证状态。

### 联网检索（自建，零成本）

图鉴外的菜品会联网检索，**不依赖任何付费检索 API**。两路并行、结果合并去重：

| 来源 | 说明 |
|---|---|
| 自建 SearXNG | `SEARXNG_URL`，聚合国内搜索引擎 |
| Bing RSS | 内置兜底，`https://cn.bing.com/search?...&format=rss`，无需 Key |

任何一路有结果就能用；两路都空才判定「无资料」。日志会标出来源：

```
[web-search] provider=searxng endpoint=127.0.0.1:8080 stage=response status=200 results=4 engines=360search down=quark duration=1177ms
[web-search] provider=searxng endpoint=cn.bing.com stage=bing-rss status=200 results=6 duration=310ms
```

**SearXNG 部署**

```bash
docker run -d --name searxng --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -v /opt/searxng:/etc/searxng \
  -e SEARXNG_BASE_URL=http://127.0.0.1:8080/ \
  ghcr.io/searxng/searxng:latest
```

- 只监听 `127.0.0.1`，不对外暴露
- `settings.yml` 必须开 `search.formats: [html, json]`，`server.limiter: false`
- 机房 IP 会被搜索引擎限流，`baidu`（CAPTCHA）、`google`/`duckduckgo`（不通）建议禁用；`360search`/`sogou`/`quark` 可用但会周期性冷却
- 自带健康检查：`/opt/searxng/healthcheck.sh` 每 5 分钟探测一次，连续两次 0 结果就重启容器

**配置**

```bash
SEARCH_PROVIDER=searxng      # 保留字段，检索已固定走自建 + Bing RSS
SEARXNG_URL=http://127.0.0.1:8080
# SEARCH_API_KEY 已不再用于检索（智谱检索已下线）
```

**诊断**

```bash
node scripts/diagnose-search.mjs
```

输出实例地址、HTTP 状态、结果数、命中/不可用引擎、耗时与建议。

检索失败不影响菜谱生成：降级为「基于模型已有知识」，页面标注未联网核实。

## Epicure 风味服务（外部 MCP）

厨房页的风味图谱、食材库与配方设计，用的是**外部 Epicure MCP**，不是本站自建的风味引擎。本站只做客户端与降级：

| 项 | 说明 |
|---|---|
| 协议 | Streamable HTTP + JSON-RPC；超时、并发、缓存都可配 |
| 端点 | `EPICURE_MCP_URL`，默认 `https://epicure-mcp.kaikaku.ai/mcp` |
| 关闭 | `EPICURE_ENABLED=false` 后整块功能降级，聊天 / 菜谱 / 推荐照常工作 |
| 降级 | 外部不可用时用本地食材目录与缓存数据，界面标注来源，不伪造风味图形 |
| 状态 | 后台「后台概览 → Epicure 外部服务状态」可一键真实探测，或 `GET /api/admin/service-health?probe=1` |

服务端接口：`GET /api/epicure/status|tools|ingredients`、`POST /api/epicure/network|autoadd|analyze|create|pair`。其中 `network` 需要 `{ids, depth, topK, expand}` 结构；`autoadd` 新增的食材会进入本地食材库。

> 边界：`analyze / pair / create` 目前只有服务端接口，后台没有做调用入口；后台只展示真实探测结果，不做「配置了 URL 就算在线」的判断。

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `AI_CONFIG_SECRET` | ✅ | 32 字节 base64/hex，用于加密用户 API Key。**丢失后已存的 Key 无法解密** |
| `AI_CONFIG_KEY_VERSION` | | 密钥版本号，配合轮换使用，默认 `1` |
| `AI_CONFIG_SECRET_PREVIOUS` | | 轮换期间解密旧密文用 |
| `ADMIN_EMAILS` | | 管理员白名单，逗号分隔；命中者登录即同步为 `admin`，移出后下次请求降级 |
| `EPICURE_ENABLED` | | 外部 Epicure MCP 总开关，默认 `true`；`false` 时相关功能整体降级 |
| `EPICURE_MCP_URL` | | Epicure 端点，默认 `https://epicure-mcp.kaikaku.ai/mcp` |
| `EPICURE_TIMEOUT_MS` | | 单次调用超时，默认 `10000` |
| `EPICURE_CACHE_TTL_MS` | | 工具列表缓存，默认 `300000`（5 分钟） |
| `EPICURE_MAX_CONCURRENCY` | | 并发上限，默认 `3` |
| `SEARXNG_URL` | | 自建 SearXNG 地址，默认 `http://127.0.0.1:8080` |
| `SEARCH_PROVIDER` | | 保留字段；检索已固定走自建 SearXNG + Bing RSS |
| `SEARCH_API_KEY` | | 旧版检索用；当前检索链路不再使用，留空即可 |
| `SESSION_TTL_DAYS` | | 登录有效期，默认 7 |
| `PORT` | | 生产端口，默认 5190 |

> `.env` 已在 `.gitignore` 中。请不要把真实密钥提交到仓库。

## 目录结构

```
├── index.html            入口 HTML（导航骨架）
├── vite.config.js        dev 服务器 + API 中间件
├── server/
│   ├── index.mjs         生产入口：静态托管 + /api
│   ├── api.mjs           全部路由
│   ├── admin-routes.mjs  后台接口（概览 / 服务状态 / 帖子 / 图鉴 / 举报 / AI）
│   ├── auth.mjs          Cookie 会话、管理员白名单与角色同步
│   ├── service-health.mjs 服务健康表（上次成功 / 上次失败分开记）
│   ├── epicure-client.mjs 外部 MCP 客户端、错误分类、真实探测
│   ├── epicure-service.mjs 厨房的风味图谱与配方编排（含降级）
│   ├── site-ai.mjs       全站内置模型（多套配置 + 总开关）
│   ├── ai-adapter.mjs    OpenAI 兼容适配层（流式/JSON/连接测试）
│   ├── ai-config.mjs     用户级 AI 配置读写与验证
│   ├── db.mjs            SQLite（users / sessions / ai_configs / site_ai / 图片覆盖 / 举报 / 审计）
│   ├── security.mjs      scrypt / AES-256-GCM
│   ├── recipe-lookup.mjs 菜名规范化、图鉴匹配、真实检索
│   ├── web-search.mjs    SearXNG + Bing RSS 检索封装
│   ├── prompt.mjs        各类系统提示词
│   └── community.mjs     社区（帖子 / 评论 / 举报计数 / 软删除）
├── src/
│   ├── main.js           启动、路由、账号组件挂载
│   ├── book/             画册外壳：章节、纸张、翻页、书签、双页拆分
│   ├── lib/              转场、剪贴板、图片覆盖层、DOM 工具
│   ├── views/            各页面（含 admin.js 后台）
│   ├── data/             菜品、菜系、味型、人格数据
│   └── styles/           主题与各模块样式（admin.css 后台）
├── docs/
│   ├── DEPLOY.md         发布与同步（本地 → 服务器 → GitHub）
│   └── ADMIN-BACKEND.md  后台模块台账与验收记录
└── scripts/              校验脚本（Playwright）、部署与同步脚本
```

## 数据说明

- 图鉴内置 97 道菜（`src/data/dishes.js` + `library-dishes.js`），含菜系、味型、食材、技法、风味、知识点
- 社区与评论的种子数据在 `data/*.json`，首次启动自动写入
- 用户、会话、AI 配置存 `data/foodsoul.db`（不入库）

## 已知限制

- **仅支持 OpenAI 兼容接口**。Anthropic / Gemini 原生协议需要走兼容网关。
- **配置了模型 ≠ 具备联网能力**。联网检索走自建 SearXNG + Bing RSS，不需要付费 Key。
- **单实例部署**。SQLite 适合单机；多实例需要换 Postgres/MySQL，并把限流改成共享存储。
- 限流基于单进程内存，重启后重置。
- 未实现邮箱验证、找回密码、双因素登录。
- HTTP 环境下 `crypto.randomUUID` 与 `navigator.clipboard` 不可用，已在 `src/lib/clipboard.js` 做回退。
- 后台只覆盖「已经存在的数据模型」：没有待审核队列、菜品增删改、用户管理、独立审计页——这些在页面上会明确说明，而不是放无效按钮。
- 「首页图片」功能已移除：旧 3D 转盘是唯一消费方，转盘删除后该功能没有可见效果；`card_images` 表与历史数据保留，但后台与前端都不再读写。
- 后台写接口统一用 `readJson(req).catch(() => ({}))`，非法 JSON / 413 会被当成空对象，存在静默失败风险（待单独修）。
- Epicure 的 `analyze / pair / create` 只有服务端接口，尚未接入后台。

## 校验脚本

```bash
node scripts/verify-ai-config.mjs          # 账号隔离 / 密钥加密 / 越权
node scripts/verify-ai-ui.mjs              # 注册→接入→聊天→退出→重登
node scripts/verify-recipe-search.mjs      # 菜谱两阶段查询与来源
node scripts/verify-chat-suggestions.mjs   # 对话延伸建议
node scripts/check-chat-responsive.mjs     # 聊天页多视口自适应
node scripts/verify-admin.mjs              # 后台权限：未登录 401 / 普通用户 403
node scripts/verify-admin-ui.mjs           # 后台各页加载与关键控件
node scripts/verify-epicure.mjs            # Epicure 连接与工具调用
```

需要先启动 dev server（`npm run dev`，端口 5180）。

后台逐模块的真实读写记录（帖子编辑/隐藏/恢复、举报状态流转、图鉴换图回读、审计落库）与 PC / 平板 / 手机截图见 [`docs/ADMIN-BACKEND.md`](docs/ADMIN-BACKEND.md) 与 [`docs/admin-shots/`](docs/admin-shots/)。

## 许可

MIT
