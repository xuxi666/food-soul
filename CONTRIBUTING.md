# 贡献与开发说明

本文档面向参与 **食有灵 · FOOD SOUL** 开发的成员。项目采用原生 JavaScript + Vite + Node.js 原生 HTTP 服务，提交前请先确认本地可以构建。

## 开发流程

```bash
git clone https://github.com/xuxi666/food-soul.git
cd food-soul
npm ci
cp .env.example .env
npm run dev
```

开发地址为 `http://127.0.0.1:5180`。修改 `.env` 后需要重启服务端；Vite 前端会热更新。

## 目录约定

- `src/book/`：画册外壳、章节、纸张、翻页和书签，不把业务数据写进布局层。
- `src/views/`：章节页面；页面只通过 `src/lib/api.js` 访问后端。
- `src/components/`：可复用交互组件，例如音乐、评论和小精灵。
- `server/`：HTTP 路由、数据库、AI 适配和外部服务。路由层不直接堆叠业务算法，复杂逻辑放到对应 service 模块。
- `public/`：静态资源和运行时上传目录；用户上传内容不要提交。
- `docs/`：部署、模块、数据和验收记录。

## 代码风格

项目没有强制 ESLint/Prettier 配置，现有代码约定如下：

- 2 空格缩进，LF 换行，文件末尾保留一个换行；
- JavaScript 使用 ESM `import/export`，语句使用分号；
- 文件与目录使用小写短横线或语义化单词；
- 变量、函数使用 `camelCase`，类/导出类型使用 `PascalCase`；
- 异步流程必须处理失败分支，不要把异常静默吞掉；
- 新增环境变量必须同步更新 `.env.example` 和 README；
- 不要把真实密钥、服务器密码、用户数据或私钥写入源码、文档或测试脚本。

## 提交信息

请使用能说明实际改动的提交信息：

```text
feat: 新增功能
fix: 修复问题
docs: 更新文档
refactor: 重构代码
style: 调整格式
test: 增加测试
chore: 项目维护
```

不要在提交中混入无关文件，不要为了增加提交数量拆分无意义改动，不要伪造提交作者或开发日期。

## 验证

```bash
npm run build
node --check server/index.mjs
```

需要浏览器集成验收时，先启动开发服务，再运行 `scripts/verify-*.mjs`。这些脚本依赖本地数据库、账号或外部服务，运行前请阅读脚本顶部注释。管理员相关脚本需要显式提供 `ADMIN_EMAIL`、`ADMIN_PASS` 环境变量；仓库不保存测试密码。

## 提交与同步

- 推送到 `origin` 前先执行 `git fetch origin` 和 `git status`；
- 不要使用 `git push --force` 覆盖他人提交；
- 生产发布使用项目维护者配置的 `npm run ship`，普通文档改动不需要触发生产部署；
- 发现历史中可能包含敏感信息时，立即停止公开传播并按 [SECURITY.md](SECURITY.md) 处理，不要擅自重写远程历史。