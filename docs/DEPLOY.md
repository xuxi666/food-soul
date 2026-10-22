# 发布与同步说明（本地 ↔ 服务器 ↔ GitHub）

本文档描述 **食有灵 FOOD SOUL** 的代码如何从本机同步到线上服务器，并自动回到 GitHub。
接手项目后，日常只需要记住一条命令：

```bash
npm run ship -- -m "feat: 这次改了什么"
```

---

## 1. 三段式结构

```
本机工作区 (F:\AIweb\美食1.0\aimeishi2.0)
   │  ① git commit + bundle 传输（SSH）
   ▼
线上服务器 /opt/food-soul   39.106.251.146
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
| `npm run deploy:status` | 查看服务器上一次部署结果 |
| `npm run deploy:setup` | 首次接管服务器：建仓库 + 装钩子（幂等，可重复跑） |
| `node scripts/ship.mjs --install-hook` | 只重装部署钩子 |
| `node scripts/ship.mjs --github-setup` | 生成 GitHub 部署密钥并打印公钥 |
| `node scripts/ship.mjs --via=git` | 改用 `git push deploy main` 传输（默认是 bundle + scp） |

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

`.deploy.env`（**不入库**）：

```ini
DEPLOY_HOST=39.106.251.146
DEPLOY_USER=root
DEPLOY_PORT=22
DEPLOY_APP=/opt/food-soul
DEPLOY_KEY=$HOME/.ssh/food_soul_deploy
```

`DEPLOY_KEY` 指向服务器免密登录私钥。`ship.mjs` 会自动把 `deploy` 远程写成
`ssh://root@39.106.251.146:22/opt/food-soul`，并把 `core.sshCommand` 指向这把私钥。

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
ssh -i ~/.ssh/food_soul_deploy root@39.106.251.146 \
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
| `GnuTLS recv error` / `Failed to connect to github.com` | 服务器直连 GitHub 偶发中断，`bootstrap.sh` 已内置 4 次重试；部署钩子失败不影响线上，重跑 `npm run deploy` 即可补推 GitHub |
| `untracked working tree files would be overwritten` | 服务器上存在与仓库同名的未跟踪文件，先登录服务器 `rm` 掉那个文件再发布 |
| 部署成功但 GitHub 显示 `鉴权失败` | 部署密钥未添加或未勾选 write access，重跑 `--github-setup` 后到 GitHub 添加 |
| 构建失败 | 看服务器 `.deploy/build.log`；本地先 `npm run build` 复现 |
| 页面没变化 | 浏览器缓存；确认 `dist/assets/index-*.js` 的 hash 变了 |
| 想回滚 | 本地 `git revert` 后重新 `npm run ship`；不要在服务器上改代码 |

## 6. 安全约定

- `.env`、`.deploy.env`、`data/`、`public/uploads/` 永远不入库。
- GitHub 写权限只通过**服务器上的部署密钥**提供，本机不需要保存 GitHub Token。
- 部署私钥 `~/.ssh/food_soul_deploy` 只用于这台服务器，泄露后重生成并替换 `authorized_keys`。