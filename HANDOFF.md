# 食有灵 · FOOD SOUL 2.0 — 交接说明

> 快照时间：2026-11-07 15:40 (GMT+8)
> 交接原因：更换 AI agent 接手开发。
> **本次交接只产出文档，没有执行任何 git 写操作、没有改动源码、没有部署**。
> ⚠️ 交接期间**另一个 agent 正在同一个工作区并行操作**：它在本地提交并发布了 `6069ed8`，三端状态因此被推进。本文档是 15:40 的事实快照；接手时请重新跑一遍 §6.6 的只读命令确认，并注意**避免两个会话同时改同一批文件**。

---

## 0. 先看这一段（最容易踩的坑）

交接进行中（**15:29:59**）有一次**来自外部并行会话**的发布，不是本次交接执行的：它把本机原先领先的 8 个「画册改造」提交一并部署上线，并新增提交 `6069ed8`（`chore(ship): 新增 --allow-dirty`，只改 `scripts/ship.mjs` 与 `docs/DEPLOY.md`）。服务器部署钩子随后自动推回 GitHub；本地 `HEAD` 也由该会话推进到 `6069ed8`（`git reflog` 可见 commit 记录）。

**交接定稿时的真实状态**：

- **三端 HEAD 已经一致，都是 `6069ed8`**：本机 `main` / GitHub `origin/main` / 服务器 `deploy/main`。不需要 `pull`。
- 画册改造**已上线**：线上首页资源 `index-C-iGVQAc.js`，`/` 与 `/api/health` 均为 200，构建 ✓ / 重启 ✓ / GitHub 同步 ✓。
- 唯一未入库的东西是**本机工作区的 5 个文件**（画册响应式布局改造）+ 本文件 `HANDOFF.md`。
- 因此：**直接 clone GitHub 能拿到画册改造，但拿不到响应式改造**（那部分还没提交）。下一个 agent 若要接着做响应式，必须在这台机器的工作区里继续，或先把 WIP 提交推送。

> ⚠️ 别重复执行 `npm run ship` 或 `git push`：当前三端已同步，任何发布都会把「已提交但尚未验收的响应式改造」是否一起带上去取决于工作区状态。部署前先读 §5 的遗留项。

---

## 1. 三端对照

| 端 | 位置 | HEAD | 说明 |
| --- | --- | --- | --- |
| 本机工作区 | `F:\AIweb\美食1.0\aimeishi2.0`（分支 `main`） | `6069ed8` | HEAD 与远端一致；**5 个未提交文件 + `HANDOFF.md`** |
| GitHub | <https://github.com/xuxi666/food-soul.git>（`origin`，分支 `main`） | `6069ed8` | 含画册改造 8 提交 + `--allow-dirty` 提交 |
| 线上服务器 | `root@47.93.33.108:/opt/food-soul`（`deploy`） | `6069ed8` | <http://47.93.33.108/>，2026-11-07 15:29:59 部署，健康 200 |

- 历史链路：`5e0f08c`（10:34 的旧线上版本）→ 本地 8 个画册改造提交（`d0b1682` → `9ba0b59`）→ 外部会话提交 `6069ed8`（15:29:59）+ 部署 → 服务器自动推回 GitHub。无分叉。
- 8 个画册改造提交内容：全站改为典藏画册容器、章节双页定制、社区/菜谱/厨房分栏、封面 15° 倾斜回正、书页放大铺满视口等。
- 服务器 `.deploy/last.json`：`commit: 6069ed8`、`build_ok: true`、`restart_ok: true`、`health: "200"`、`github_ok: true`；pm2 进程 `food-soul` online，nginx active。
- GitHub HTTPS 凭据可用（`git push --dry-run origin main` 已验证，走 Windows credential manager）。

### 分支

| 分支 | 用途 |
| --- | --- |
| `main` | 工作分支 |
| `backup/pre-sync-20261022` | 与 GitHub 对齐之前的本地历史备份 |
| `backup/album-705cb89` | 3D 美食画册（移植翻页引擎）备份 |

---

## 2. 仓库、凭据与不入库文件

| 项 | 值 / 位置 |
| --- | --- |
| `origin` | `https://github.com/xuxi666/food-soul.git`（HTTPS，凭据由 Windows credential manager 提供） |
| `deploy` | `ssh://root@47.93.33.108:22/opt/food-soul` |
| 部署私钥 | 本机 `~/.ssh/food_soul_deploy`（即 `C:\Users\33132\.ssh\food_soul_deploy`），由 `.deploy.env` 的 `DEPLOY_KEY=$HOME/.ssh/food_soul_deploy` 指定。已验证可免密登录服务器 |
| 服务器地址唯一事实来源 | 本机 `.deploy.env`（`DEPLOY_HOST=47.93.33.108` / `DEPLOY_USER=root` / `DEPLOY_PORT=22` / `DEPLOY_APP=/opt/food-soul`） |
| 运行时配置 | 本机 `.env`：`SEARCH_API_KEY`、`PORT`、`AI_CONFIG_SECRET`、`AI_CONFIG_KEY_VERSION`、`SEARCH_BASE_URL`、`SESSION_TTL_DAYS`、`ADMIN_EMAILS`、`SEARCH_PROVIDER`、`SEARXNG_URL`。具体值不写进文档，直接读文件 |
| 服务器侧 GitHub 部署密钥 | 在服务器 `/opt/food-soul`，一次性配置方法见 `docs/DEPLOY.md` §4.2 |

**gitignored、换机器必须重新配置**：`.env`、`.deploy.env`、`data/*.db*`、`data/comments.json`、`data/community.json`、`public/uploads/`、`public/dishes/generated/`、`dist/`、`node_modules/`、`shots/`、`.tmp/`、`.workbuddy-ai/`。

旧文档里出现过的 `39.106.251.146` 已失效，**一律以 `.deploy.env` 的 `DEPLOY_HOST` 为准**。

---

## 3. 线上架构与发布命令

```
本机 (F:\AIweb\美食1.0\aimeishi2.0)
  │ ① npm run ship -- -m "..."  → commit + git bundle + scp（SSH）
  ▼
服务器 /opt/food-soul  (47.93.33.108)
  │ ② post-receive 钩子：npm ci(按需) → npm run build → pm2 restart food-soul → 健康检查
  │ ③ 服务器自动 git push origin main
  ▼
GitHub xuxi666/food-soul
```

`nginx`（80，反代 `127.0.0.1:5190`，`server_name _`）→ `node server/index.mjs`（静态托管 `dist/` + `/api/*`，pm2 名称 `food-soul`）。服务器 `/opt/food-soul` 本身就是一个 git 工作区，`data/`、`.env`、`node_modules`、`dist`、`public/uploads` 都被忽略，**部署不会覆盖运行时数据**。

| 命令 | 作用 |
| --- | --- |
| `npm run ship -- -m "msg"` | 提交 + 部署 + 由服务器推回 GitHub（日常一条命令） |
| `npm run deploy` | 只发布当前 HEAD（要求工作区干净） |
| `npm run deploy:status` | 查看服务器上次部署结果 |
| `npm run deploy:setup` | 首次接管服务器（幂等） |
| `npm run deploy:github` | 在服务器生成 GitHub 部署密钥并打印公钥 |
| `npm run deploy:hook` | 重新安装部署钩子 |

`6069ed8` 给 `scripts/ship.mjs` 新增了 `--allow-dirty`：工作区有 WIP 时也能只发布已提交的 HEAD（本次交接未使用该能力）。机制细节与故障排查（含 non-fast-forward）见 `docs/DEPLOY.md`（该文档已随 `6069ed8` 更新）。Windows 上 PowerShell 可能禁用 `npm.ps1`，可直接用 `ship.cmd -m "msg"`。

---

## 4. 本机开发环境（有两个坑）

- 项目根目录 `F:\AIweb\美食1.0\aimeishi2.0`，Node `v22.22.2`（`engines: >=22.5`，用到内置 `node:sqlite`）。
- **本机同时跑着两个 Vite dev server，服务的是不同目录**：

  | 端口 | PID | 实际目录 | 用途 |
  | --- | --- | --- | --- |
  | `5190` | 26440 | **`F:\AIweb\美食1.0\aimeishi2.0`（当前项目）** | 本会话所有 QA 都打这个，热更新能看到当前源码 |
  | `5180` | 8880 | `E:\workbuddyAI\food-soul`（另一份副本） | **不是本项目**，别改错目录、别拿它看效果 |

  `npm run dev` 按 `vite.config.js` 固定走 `0.0.0.0:5180` 且 `strictPort`，会被上面那个副本占用；本会话因此用 `vite --port 5190`。**验收请认准 5190**。
- 浏览器 QA：`playwright-core` + 本机 Chrome `C:/Program Files/Google/Chrome/Application/chrome.exe`，headless。截图落在 `shots/`（gitignored），已有 `resp-<分辨率>-closed/open.png` 七组对照图。
- 构建：`npm run build` → `dist/`；生产 `npm start` → `127.0.0.1:5190`。本会话**没有重新执行 build**（线上那次构建由外部发布触发），本地提交前建议跑一次。
- `git` 有 CRLF 提示属正常，`.gitattributes` 已统一 LF。

---

## 5. 工作区里未提交的活：画册响应式布局改造

目标：让典藏画册在任意分辨率下（含手机竖屏、横屏、平板、2K/4K）都完整贴合视口、不出现滚动条与横向溢出，并统一「单页 / 双页」的判定口径。**这部分代码只存在于本机工作区，GitHub 和线上都没有。**

| 文件 | 状态 | 改动 |
| --- | --- | --- |
| `src/book/layout.js` | **新增** | 抽出的布局控制器：`computeLayout()` 用 `visualViewport` 量可视区、按 `RATIO` 约束书页高宽比（双页 `h/w` 0.52–0.72，单页 1.05–1.8）、四周留白；`observeLayout()` 用 `ResizeObserver` + resize/orientationchange/visualViewport 事件统一驱动；导出 `BREAKPOINT = 860` |
| `src/book/index.js` | 改 | `fit()` 改为调用 `computeLayout()` 并切换 `.is-single`；尺寸/模式变化时写 `data-fitted`，模式切换时调 `atlas.repaint()`；返回值新增 `destroy()` 用于解绑监听 |
| `src/book/book.css` | 改 | `.bk-stage` 加 `100dvh/100dvw`；移动端单页断点从 `max-width:860px` 改为 `max-width:720px` 或 `860px + 竖屏`；单页模式隐藏左页码、右页码底部居中 `bottom:38px` 避开翻页按钮和小精灵 |
| `src/book/atlas.css` | 改 | 图鉴单列/隐藏右页的条件从媒体查询改为 `.bk-stage.is-single`（避免窄屏双页模式被误判）；窄屏卡片保持两列 |
| `src/book/atlas.js` | 改 | `perScreen()` 由 `window.innerWidth <= 860` 改为读 `.bk-stage.is-single`，单页 4 道 / 双页 8 道 |

### 已验收（2026-11-07 15:30，实测 5190 当前源码）

| 分辨率 | 合页 | 展开 | 书签 | 滚动条 | 横向溢出 | 模式 |
| --- | --- | --- | --- | --- | --- | --- |
| 1366×768 | OK | OK | OK | 无 | 无 | 双页 |
| 1920×1080 | OK | OK | OK | 无 | 无 | 双页 |
| 2560×1440 | OK | OK | OK | 无 | 无 | 双页 |
| 1024×768 | OK | OK | OK | 无 | 无 | 双页 |
| 768×1024 | OK | OK | OK | 无 | 无 | 单页 |
| 390×844 | OK | OK | OK | 无 | 无 | 单页 |
| 844×390 | OK | OK | OK | 无 | 无 | 双页 |

七组全部无 JS 报错。矩阵脚本里单页的「中缝居中」判定为 FAIL 属**测试口径问题**：单页模式本来就没有中缝，已单独确认 `.bk-gutter` 在 `768×1024` / `390×844` 下 `opacity:0` 隐藏、左页码 `display:none`、右页码不与翻页按钮/小精灵重叠，不是缺陷。

### 遗留 / 建议接手后处理

1. **页码文案**：单页阅读态下右页码元素的 `textContent` 为空（`shell.setFolio()` 只在翻页时写入），初始进入时可能不显示页码。确认是否需要初始化赋值。
2. `src/book/book.css` 中 `.bk-stage.is-reading .bk-page__folio--right { right: 8px; }` **重复定义了两次**（约 1044 / 1048 行），可清理。
3. `844×390` 横屏走双页，书页偏扁，内容密度建议人工目视复核（`shots/resp-844x390-open.png`）。
4. 未做真机 / 高 DPR / 折叠屏 / 浏览器缩放测试；未跑全站回归脚本（`scripts/verify-*.mjs`）。
5. 提交前跑一次 `npm run build`。**在 1–4 处理完之前，不建议把这次响应式改造部署到生产**。

---

## 6. 建议的接手顺序

1. 读完本文件 → `docs/DEPLOY.md`（发布机制，刚随 `6069ed8` 更新，准确）→ `docs/PROJECT-HANDOVER.md`（**历史快照**：写于画册改造之前，目录/配色/后端 API 部分仍有效，但「前端结构 / 路由与视图」章节已过时，请勿当作现状）。
2. **先确认没有其他会话正在改同一批文件**：`git status --short`、`git log --oneline -5`。当前应为 4 个改动的 `src/book/*` + 新增 `layout.js` + `HANDOFF.md`，HEAD `6069ed8`。
3. 三端 HEAD 已一致，**不需要 `pull`**；若发现远端又前进了，再 `git pull --ff-only`（`6069ed8` 之后若有提交，先确认是否碰 `src/book/*` 再决定）。
4. 决定工作位置：
   - **继续在本机做**：直接在 `F:\AIweb\美食1.0\aimeishi2.0` 改，验收打 `5190`。
   - **换机器 / 换 agent 从仓库开始**：先 `git add -A && git commit -m "..."`，再 `git push origin main`（此时是快进，安全）。
5. 要上线时 `npm run ship -- -m "..."`（新版本另有 `--allow-dirty`，可只发布已提交的 HEAD），之后用 `npm run deploy:status` 和健康检查确认。
6. 常用只读检查：`git status` / `git log --oneline -10` / `git ls-remote --heads origin main` / `git ls-remote --heads deploy main` / `curl -I http://47.93.33.108/` / `npm run deploy:status`。

---

## 7. 本次交接实际做了什么

- ✅ 新增本文件 `HANDOFF.md`（仓库根目录，**未提交、未推送**）。
- ✅ 只读检查：git 状态与远端对比、部署状态、线上健康与首页资源、端口/进程归属、七分辨率 QA 复核、单页模式元素检查、GitHub 提交元信息、reflog。
- ✅ 临时 QA 脚本写在 `.tmp/` 并已删除，未留下新脚本；`shots/` 未新增截图。
- ❌ 本次交接**没有** `git add` / `commit` / `push` / `pull` / `ship` / 部署 / 构建；没有改动任何源码。
- ⚠️ 交接期间（15:29:59）**另一个并行会话**在**同一个工作区**提交了 `6069ed8` 并发布上线、同步 GitHub，与本次交接无关。三端 HEAD 因此一致，已在 §0 / §1 如实记录。
- 因此 `git status` 现在多出一条 `?? HANDOFF.md`；`src/book/*` 的 5 个 WIP 文件与交接前完全一致，未被触碰。

---

## 8. 接手后的第一轮（2026-11-07 15:5x，本文件同批提交）

接手 agent 做的事，全部在本机工作区完成后再统一发布：

1. **页码初始为空 → 已修**：`src/book/index.js` 新增 `folioFor(path)`（路径 → 左右页文案的唯一来源），四个分支的 `setFolio` 全部改用它；`openFirst()` 在动画开始前就写入页码。实测 t=0ms 已有文案（此前 0–780ms 是空的）。
2. **`book.css` 重复规则 → 已删**：`.bk-stage.is-reading .bk-page__folio--right{right:8px}` 原来写了两遍。
3. **844×390 横屏密度 → 已修**：根因是页眉（标题+筛选条+搜索框）占 177px，2×2 卡片只剩 50px 高、`.atlas__media` 被压成 0，图片完全看不见。新增 `@media (max-height:620px)`：页眉压到 105px、简介隐藏、筛选条单行横滑、卡片内边距收紧。实测卡片 50→88px、图片区 0→45px、页内无溢出。
4. **验收**：7 分辨率 × 7 章节 = 21 组，`0` 溢出、`0` 控制台报错、页码全部非空；`npm run build` 通过。
5. **入库并发布**：5 个响应式改造文件 + 本文件一起提交 → `npm run ship` 部署 → 服务器构建 + 重启 + 推回 GitHub。上线后自查：三端 HEAD 一致、`/api/health` 200、线上首页资源哈希已更新。

> 仍需人工目视确认的只有一项：844×390 下卡片观感是否可接受（数据层面已从 `media=0` 恢复到 45px）。

---

## 9. 阴影独立化 + 禁止自动开书（`76748ab`、`e7caef9`）

### 9.1 阴影不再跟随 15° 倾斜（`76748ab`）

- 原实现把 `.bk-book__shadow` 放在 `.bk-book` 内部，父级 `rotateZ(15deg)` 会把阴影一起转。改为 `.bk-camera > [.bk-shadow, .bk-book]` 兄弟结构，阴影层 `transform: none`。
- 位置由 JS 计算：`index.js` 的 `fitShadow()` 读「可见物体」包围盒（合上取 `.bk-cover`，展开取 `.bk-spread`）写 `left/top/width/height`；`setBookState()` 后 `followShadow()` 逐帧贴合 800ms。因此只跟随位置/尺寸，永不继承旋转。
- 两层：`.bk-shadow__contact`（blur 8px 贴底）、`.bk-shadow__ambient`（blur 26px，向下溢出 9%）。
- 量化验收（截屏差分，`.tmp/shadow-metrics3.mjs` + `.tmp/shadow-metrics2.py`）：旧版阴影主轴 **15.9°**、长宽比 17.9、水平范围 186–777（偏到封面左侧）；新版未遮挡部分主轴 **0.2°**、长宽比 3.9、范围 559–874（正落封面 485–944 下方）。桌面 1440×900 / 手机 390×844 五状态 `dxCenter=dyBottom=0`。

### 9.2 禁止自动开书（`e7caef9`）

- 删除唯一一处自动开书：`src/book/index.js` 末尾的 `if (deepLink) setTimeout(() => void openFirst(), 600)`。深链现在只用于高亮书签；点开封面后 `openFirst()` 仍用 `location.pathname` 作为目标，所以 `/community` 深链 = 合上 → 点击 → 直接落到社区章。
- `popstate`：合上状态下不再调 `openFirst()`，只 `shell.setActive()`；`a[data-link]` 点击在合上状态只 `pushState` + 高亮，不开书。
- 开书入口只剩两处，都是用户动作：`.bk-cover` 的 `click` 与 `keydown`(Enter/Space)。`openFirst()` 仍有 `phase !== 'CLOSED_TILTED' || busy` 双闸，连点不会重入。
- 悬停反馈：`.bk-cover:hover .bk-cover__front { filter: brightness(1.035) }` + `:focus-visible` 描边；封面提示文字沿用原有的 `.bk-cover__hint`（「轻点封面 · 翻开画册」+ `bk-breathe`）。
- 验收（`.tmp/no-auto-open.mjs`，对线上跑，20/20 全过）：首屏合上、等 30 秒仍合上、悬停不开、点背景不开、改窗口不开、`visibilitychange/focus/pageshow` 不开、点封面开、Esc 回到合上且 12 秒不重开、连点不错乱、深链合上且点开落到 community、刷新回落合上、手机首屏合上、0 控制台报错。

> 行为变化提示：以前访问 `/dishes`、`/community` 等深链会自动展开画册，现在一律停在封面等一次点击——这是需求要求的「用户不点，书永远合上」。
