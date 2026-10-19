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
