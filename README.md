# 食有灵 · FOOD SOUL

> 中国美食 × 用户自接入 AI 大模型。八大菜系与八种味型的 3D 环形画廊、菜品人格对话、结构化菜谱生成、真实来源检索、美食社区。

[![Node](https://img.shields.io/badge/node-%E2%89%A522.5-339933)](https://nodejs.org/)
[![Vite](https://img.shields.io/badge/vite-5-646CFF)](https://vitejs.dev/)
[![Three.js](https://img.shields.io/badge/three-0.160-000000)](https://threejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue)](#许可)

## 这是什么

一个以「中国菜」为主题的互动站点。首页是一圈可以拖拽旋转的 3D 卡片环，点任意卡片会以圆形扩散转场进入对应页面；每个菜品、菜系、味型都有自己的 AI 人格，可以对话、生成菜谱、找相似口味。

**关键设计：站点本身不内置任何模型密钥。** 每个用户登录后，在右上角「接入 AI」里填入自己的模型服务（任意 OpenAI 兼容接口），密钥经 AES-256-GCM 加密后存进服务端数据库，每次请求按当前登录用户解密使用。

## 功能

| 模块 | 说明 |
|---|---|
| 3D 环形画廊 | Three.js 手写，拖拽旋转、点击选中、HTML 面板经单应性矩阵投影贴合卡片 |
| 圆形扩散转场 | 从点击坐标扩散覆盖全屏，支持 `prefers-reduced-motion` |
| 双模式探索 | 八大菜系 / 八种味型，两套独立数据，切换不残留 |
| 菜品人格对话 | 每个菜品有独立人格提示词，SSE 流式输出，支持多轮上下文 |
| 对话延伸建议 | 每条回答结束后生成 1–3 条可点击的后续建议（不阻塞主回答） |
| 菜谱工作台 | 手动输入菜名 → 图鉴优先匹配 → 图鉴没有则**真实联网检索**并展示来源 |
| 美食推荐 | 按口味、预算、人数、可用食材筛选并让模型排序 |
| 美食社区 | 发帖、回复、点赞、图片上传、举报、删除自己的内容 |
| 账号体系 | 邮箱 + 密码，scrypt 哈希，HttpOnly Cookie 会话 |
| 用户级 AI 配置 | 服务商预设 / 自定义 Base URL / 模型 ID / 连接测试 / 密钥加密存储 |

## 技术栈

- **前端**：Vite 5 + 原生 ES Modules + Three.js 0.160（无框架）
- **后端**：Node.js 原生 `http`，无 Express
- **数据库**：`node:sqlite`（Node ≥ 22.5 内置），单文件 `data/foodsoul.db`
- **加密**：`node:crypto` —— scrypt 密码哈希、AES-256-GCM 密钥加密
- **AI**：OpenAI 兼容 `/chat/completions`，SSE 流式
- **检索**：智谱 Web Search API（独立于用户聊天模型）

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


## 管理后台

访问 `/admin`。入口按钮只对管理员显示，权限完全由服务端判定。

**授权方式**：在服务端 `.env` 配置白名单，命中邮箱的账号登录后自动成为管理员：

```bash
ADMIN_EMAILS=you@example.com,another@example.com
```

- 角色存在 `users.role`，由服务端按白名单同步；前端传入的任何 `role` / `userId` 都不被信任
- 移出白名单后，该账号下次请求即降级为普通用户
- 未登录访问管理接口返回 `401`，普通用户返回 `403`

**功能模块**：

| 模块 | 说明 |
|---|---|
| 后台概览 | 帖子/举报/卡片/菜品统计 + 最近管理操作 |
| 社区内容 | 关键词搜索、分页、查看详情、软删除（保留审计） |
| 首页图片 | 八大菜系 / 八大口味卡片分别管理，可替换或恢复默认 |
| 美食图鉴 | 按菜名搜索、替换菜品默认图片 |
| 举报处理 | 按状态筛选，标记处理中 / 驳回 / 确认违规并删除 |

图片替换写入 `card_images` / `dish_images` 表，前端启动时通过 `GET /api/assets/overrides` 拉取并写回本地数据源，因此首页、图鉴、详情页始终一致。


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

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `AI_CONFIG_SECRET` | ✅ | 32 字节 base64/hex，用于加密用户 API Key。**丢失后已存的 Key 无法解密** |
| `AI_CONFIG_KEY_VERSION` | | 密钥版本号，配合轮换使用，默认 `1` |
| `AI_CONFIG_SECRET_PREVIOUS` | | 轮换期间解密旧密文用 |
| `SEARCH_API_KEY` | | 联网检索服务的 Key。未配置时菜谱来源检索与图鉴补全会明确提示，**不会伪造来源** |
| `SEARCH_BASE_URL` | | 检索服务地址，默认智谱 |
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
│   ├── ai-adapter.mjs    OpenAI 兼容适配层（流式/JSON/连接测试）
│   ├── ai-config.mjs     用户级 AI 配置读写与验证
│   ├── auth.mjs          Cookie 会话与鉴权
│   ├── security.mjs      scrypt / AES-256-GCM
│   ├── db.mjs            SQLite（users / sessions / ai_configs）
│   ├── recipe-lookup.mjs 菜名规范化、图鉴匹配、真实检索
│   ├── web-search.mjs    联网检索封装
│   ├── prompt.mjs        各类系统提示词
│   └── community.mjs     社区
├── src/
│   ├── main.js           启动、路由、账号组件挂载
│   ├── gallery.js        Three.js 环形画廊 + 面板投影
│   ├── lib/transition.js 圆形扩散转场
│   ├── lib/clipboard.js  UUID / 复制（兼容非 HTTPS 环境）
│   ├── views/            各页面
│   ├── data/             菜品、菜系、味型、人格数据
│   └── styles/
└── scripts/              校验脚本（Playwright）与部署脚本
```

## 数据说明

- 图鉴内置 97 道菜（`src/data/dishes.js` + `library-dishes.js`），含菜系、味型、食材、技法、风味、知识点
- 社区与评论的种子数据在 `data/*.json`，首次启动自动写入
- 用户、会话、AI 配置存 `data/foodsoul.db`（不入库）

## 已知限制

- **仅支持 OpenAI 兼容接口**。Anthropic / Gemini 原生协议需要走兼容网关。
- **配置了模型 ≠ 具备联网能力**。联网检索要单独配 `SEARCH_API_KEY`。
- **单实例部署**。SQLite 适合单机；多实例需要换 Postgres/MySQL，并把限流改成共享存储。
- 限流基于单进程内存，重启后重置。
- 未实现邮箱验证、找回密码、双因素登录。
- HTTP 环境下 `crypto.randomUUID` 与 `navigator.clipboard` 不可用，已在 `src/lib/clipboard.js` 做回退。

## 校验脚本

```bash
node scripts/verify-ai-config.mjs          # 账号隔离 / 密钥加密 / 越权
node scripts/verify-ai-ui.mjs              # 注册→接入→聊天→退出→重登
node scripts/verify-recipe-search.mjs      # 菜谱两阶段查询与来源
node scripts/verify-chat-suggestions.mjs   # 对话延伸建议
node scripts/check-chat-responsive.mjs     # 聊天页多视口自适应
```

需要先启动 dev server（`npm run dev`，端口 5180）。

## 许可

MIT
