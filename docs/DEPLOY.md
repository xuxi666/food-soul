# 发布与同步说明（本地 ↔ 服务器 ↔ GitHub）

本文档描述 **食有灵 FOOD SOUL** 的代码如何从本机同步到线上服务器，并自动回到 GitHub。
接手项目后，日常只需要记住一条命令：

```bash
npm run ship -- -m "feat: 这次改了什么"
```

---

## 0. 交接速览

| 项目 | 值 |
| --- | --- |
| 线上地址 | <http://47.93.33.108/> |
| 代码仓库 | <https://github.com/xuxi666/food-soul.git>（分支 `main`） |
| 服务器 | `root@47.93.33.108:22`，应用目录 `/opt/food-soul` |
| 进程 | pm2 名称 `food-soul`，Node 监听 `127.0.0.1:5190`，nginx 反代 80 端口 |
| 部署私钥 | 本机 `~/.ssh/food_soul_deploy`（由 `.deploy.env` 的 `DEPLOY_KEY` 指定） |
| 配置来源 | 本机 `.deploy.env`（不入库）是服务器地址的唯一事实来源 |
| 最近校验 | 2026-11-07：本地 `HEAD`、服务器工作区、GitHub `main` 三者同为 `e2edecb`；构建 ✓、重启 ✓、健康检查 200、GitHub 已同步 |

> 旧版本文档里出现过的 `39.106.251.146` 已不是本项目服务器：该地址 80 端口无响应、SSH 用部署密钥被拒。**一切以 `.deploy.env` 的 `DEPLOY_HOST` 为准**，换服务器只改这一行。

## 1. 三段式结构

```
本机工作区 (F:\AIweb\美食1.0\aimeishi2.0)
   │  ① git commit + bundle 传输（SSH）
   ▼
线上服务器 /opt/food-soul   47.93.33.108
   │  ② 部署钩子：构建 → pm2 重启 → 健康检查
   │  ③ git push origin main（部署密钥）
   ▼
GitHub xuxi666/food-soul
```

- **本机**：唯一的开发工作区，先提交再发布。
- **服务器**：`/opt/food-soul` 是 GitHub 仓库的一个 git 工作区，`data/`、`.env`、`node_modules`、`dist`、`public/uploads` 都被忽略，不会被覆盖。
- **GitHub**：由服务器在部署后自动推送，保证「线上代码 = 仓库代码」。

## 2. 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run ship -- -m "feat: xxx"` | 提交本地改动 → 发布到服务器（构建 + 重启）→ 同步 GitHub |
| `npm run deploy` | 不提交，直接发布当前 HEAD（工作区有改动会中止） |
| `npm run deploy:status` | 查看服务器上一次部署结果，并打印线上地址 |
| `npm run deploy:setup` | 首次接管服务器：建仓库 + 装钩子（幂等，可重复跑） |
| `npm run deploy:hook` | 只重装部署钩子 |
| `npm run deploy:github` | 生成 GitHub 部署密钥并打印公钥 |
| `node scripts/ship.mjs --via=git` | 改用 `git push deploy main` 传输（默认是 bundle + scp） |
| `node scripts/ship.mjs --push-only --allow-dirty` | 工作区还有未提交的改动时，只发布已提交的 HEAD（不暂存、不提交，适合边改边发） |

Windows 上如果 PowerShell 禁止运行 `npm.ps1`（报「禁止运行脚本」），用下面任一种写法绕过：

```bat
npm.cmd run ship -- -m "feat: xxx"
ship.cmd -m "feat: xxx"
```

发布成功的输出长这样：

```
[deploy] 版本 ca697f6 ｜ 构建 true ｜ 健康检查 200 ｜ GitHub 已同步
────────── 服务器部署状态 ──────────
  版本      ca697f6  fix(ship): ...
  构建      ✓   重启 ✓
  健康检查  200
  GitHub    ✓  已同步
```

## 3. 本机配置

`.deploy.env`（**不入库**，`.gitignore` 已忽略）：

```ini
DEPLOY_HOST=47.93.33.108
DEPLOY_USER=root
DEPLOY_PORT=22
DEPLOY_APP=/opt/food-soul
DEPLOY_KEY=$HOME/.ssh/food_soul_deploy
```

`DEPLOY_KEY` 指向服务器免密登录私钥。`ship.mjs` 会自动把 `deploy` 远程写成
`ssh://root@<DEPLOY_HOST>:<DEPLOY_PORT><DEPLOY_APP>`，并把本仓库的 `core.sshCommand` 指向这把私钥。

## 4. 服务器端机制

### 4.1 仓库与钩子

- `/opt/food-soul` = 仓库工作区，`origin` = `git@github.com:xuxi666/food-soul.git`
- `receive.denyCurrentBranch=updateInstead`：允许直接推送并更新工作区
- `.git/hooks/post-update`：部署钩子（源文件是仓库里的 `scripts/server/post-update.sh`，`ship.mjs` 发现不一致会自动重装）

钩子做四件事：

1. `git push origin main` 同步 GitHub（鉴权失败不会阻断部署，只在状态里标记）
2. `package-lock.json` 变化或 `node_modules` 缺失时 `npm ci`
3. `npm run build`
4. `pm2 restart food-soul` + `curl /api/health`，结果写入 `.deploy/last.json`

日志：`/opt/food-soul/.deploy/deploy.log`、`build.log`、`npm.log`、`github.log`。

### 4.2 GitHub 部署密钥（一次性）

在服务器生成，私钥不出服务器：

```bash
node scripts/ship.mjs --github-setup
```

把输出的公钥贴到 GitHub：**仓库 → Settings → Deploy keys → Add deploy key**，
勾选 **Allow write access**（不勾选无法推送）。

验证：

```bash
ssh -i ~/.ssh/food_soul_deploy root@47.93.33.108 \
  "cd /opt/food-soul && GIT_SSH_COMMAND='ssh -o BatchMode=yes' git ls-remote origin main"
```

### 4.3 运行时文件（不受部署影响）

| 路径 | 说明 |
| --- | --- |
| `/opt/food-soul/.env` | 服务端密钥（AI_CONFIG_SECRET、SEARCH_*、ADMIN_EMAILS 等），**不要提交** |
| `/opt/food-soul/data/` | SQLite 与社区/评论 JSON |
| `/opt/food-soul/public/uploads/` | 用户上传图片 |
| `/opt/food-soul/dist/` | 构建产物（每次部署重建） |

## 5. 故障排查

| 现象 | 处理 |
| --- | --- |
| `GnuTLS recv error` / `Failed to connect to github.com` | 服务器直连 GitHub 偶发中断，钩子已内置 3 次重试；部署不会因此失败，重跑 `npm run deploy` 补推即可 |
| `untracked working tree files would be overwritten` | 服务器上存在与仓库同名的未跟踪文件，先登录服务器 `rm` 掉那个文件再发布 |
| 部署成功但 GitHub 显示「鉴权失败」 | 部署密钥未添加或未勾选 write access，重跑 `npm run deploy:github` 后到 GitHub 添加 |
| 构建失败 | 看服务器 `.deploy/build.log`；本地先 `npm run build` 复现 |
| 页面没变化 | 浏览器缓存；确认 `dist/assets/index-*.js` 的 hash 变了 |
| 换服务器 IP | 只改本机 `.deploy.env` 的 `DEPLOY_HOST`，再跑一次 `npm run deploy:setup`（幂等）。nginx 已改成 `server_name _`，不会因为 IP 变化而拒答 |
| 想回滚 | 本地 `git revert` 后重新 `npm run ship`；不要在服务器上改代码 |

## 6. 安全约定

- `.env`、`.deploy.env`、`data/`、`public/uploads/` 永远不入库。
- GitHub 写权限只通过**服务器上的部署密钥**提供，本机不需要保存 GitHub Token。
- 部署私钥 `~/.ssh/food_soul_deploy` 只用于这台服务器，泄露后重生成并替换 `authorized_keys`。