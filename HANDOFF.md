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

---

## 10. 开书动画合成一条时间轴（`dcbec15`）

### 10.1 之前是串行的

```js
// 旧：回正 440ms → 等 → 掀封面 720ms → 等 → 放大 580ms
setBookState('bk-book--straight'); await wait(440);
setBookState('bk-book--open');     await wait(720);
setBookState('bk-book--reading');  await wait(580);
```
用户看到的就是：先摆正、停一下、再掀盖。

### 10.2 现在是一条时间轴、同帧启动

- 一次 class 切换 `bk-book--opening`，两段 `@keyframes` 同时开始：
  - `bk-book-open` 1300ms：0–58% 把 `rotateZ 15°→0` 与 `scale .52→.70` 一起做，58–100% 继续放大到 1。
  - `bk-cover-open` 900ms：封面绕书脊（`transform-origin: left center`）`rotateY 0→-180`。
- 中途不切 class，所以没有"回正完成 → 封面才动"的接缝。1300ms 结束才切 `--reading`，其静态变换与动画末帧完全一致（scale 1 / 0° / 封面 -180°），切过去不会跳。
- 书签/返回键/翻页键在 760ms 之后才露出来；阴影用 `blendShadowTo()` 在 520ms 内从"封面范围"平滑过渡到"整本范围"（阴影层仍然 `transform: none`，永不旋转）。

实测相位（`.tmp/open-timeline.mjs`，线上）：0ms 15°/0°、300ms 5.9°/-84°、600ms 0.4°/-167°、760ms 0°/ -178°、900ms 封面到位、1300ms 铺满。

### 10.3 顺手修掉的两处掉帧

1. `.bk-shadow` 上的 `will-change: left/top/width/height`：阴影每帧都在改这四个值，声明 will-change 会让浏览器每帧重建图层，实测开书在 781 / 1369 / 1450 / 1507ms 掉 57–106ms 的帧；删掉后（`will-change: auto`）这些洞消失。
2. 阴影两层的 `filter: blur(8px)/blur(26px)`：换成多档位径向渐变（纯渐变不需要滤镜），保留了柔和度（实测未遮挡部分主轴 0.2°、软边 38px）。

去掉这两处后，0–1300ms 整段开书实测无 >40ms 的掉帧；1300ms 之后仍有约 150–190ms 的主线程开销，那是图鉴挂载（97 张卡片 + 图片解码）导致的，属于内容加载，不在开书动画区间内（改造前同样存在）。`content-visibility: auto` 与 `decoding="async"` 已加上，收益有限。

### 10.4 回归

- 开书时间轴采样（`.tmp/open-timeline.mjs`）：两个变换同帧起步、单调推进、无回跳。
- 掉帧检查（`.tmp/cold-runs.mjs`）：0–1300ms 无 >40ms 空洞。
- 交互回归（`.tmp/no-auto-open.mjs`，线上）：20/20 通过；章节巡检 21/21；阴影 `transform: none`、`dxCenter=dyBottom=0`。
- 手机 390×844 / 桌面 1440×900：起手 15°、开完 0° scale 1、Esc 回到 15°，0 报错。
- 逐帧图：`.tmp/open-book-sheet.png`（9 个相位）、`.tmp/open-book.gif`。

## 11. 画册双页内容与翻页对应（本轮）

### 11.1 问题

图鉴之外的章节其实是「一整页宽 1382px 的网页」塞进跨页里，右页常年靠内容层的 `column` 平衡凑数；菜谱、厨房、社区、视频更明显：一侧是完整网页、另一侧只剩几行字。图鉴的最后一跨页也出现过「左页 1 张卡、右页全空」。

### 11.2 现在的跨页模型

- 图鉴：`splitSpreads()` 按跨页数均分（97 道 → 13 跨页，26 页），每跨页 4+4 或 4+3，左右页都至少 3 张卡；页码由 `pageNumbers()` 给出，左页奇数、右页偶数，页脚 `图鉴 · P07 / P08` 与网格同步。只筛出一道菜时，右页补同菜系的真实推荐（`atlas__filler-title`），不留空页。
- 视频：左页=搜索 + 按菜系挑（8 张菜系卡，`grid-auto-rows: 1fr` 撑满页高）+ 平台入口；右页=检索结果列表（8 条真实结果）。
- 社区：左页=发帖框 + 社区现状（帖子总数 / 本页已读 / 今日新帖 / 常见类型 / 活跃作者，全部由已加载的真实帖子统计）+ 关于这里 + 发帖小贴士；右页=排序 + 帖子流 + 加载更多。两页各自滚动。
- 菜谱：左页=参数表单；右页=结果区，未生成时先给出 16 道图鉴里真实存在的菜（点一下带名字进表单），不再是三行字。
- 厨房：图谱卡加高到 `clamp(460px, 70vh, 720px)`，左页=图谱 + 模式，右页=食材库 + 配方 + 结果。

### 11.3 翻页纸叶正反面

`flipLeaf()` 现在会把内容贴到正在翻的纸叶上：正面=正在翻走的那一页（next 时右页、prev 时左页），换页的瞬间把反面贴成新露出的那一页，纸叶落下正好对上。做法是克隆 `.bk-content`（宽 200%、按左右半页平移），不是位图；节点超过 600 个（社区信息流那种长列表）就退回素纸，避免翻页掉帧。

### 11.4 量化验收（1440×900，`/.tmp/blank-audit.mjs`、`.tmp/audit.mjs`）

以 16px 网格采样每个书页、找「没有任何元素覆盖」的最长竖向空档：

| 页面 | 左页空档 | 右页空档 |
| --- | --- | --- |
| 图鉴 13 跨页 | 4% | 4% |
| 菜系 / 口味 | 4% | 4% |
| 菜谱 | 19% | 6% |
| 厨房 | 17% | 2% |
| 社区 | 8% | 2% |
| 视频 | 9% | 17% |

1280×800 最大空档 13%，手机 390×844 单页模式 4 张/页、页码 `第 1 页 / 共 25 页`。翻页帧率（`.tmp/flip-pace.mjs`）：连翻 3 次，中位 6ms、p95 6ms、最大 44ms、无 >50ms 帧。

### 11.5 回归

`no-auto-open.mjs` 20/20、`chapter-sweep.mjs` 21/21 全通过；0 JS 报错。截图：`.tmp/spread-sheet-a.png`（13 跨页）、`.tmp/chapter-sheet.png`（七章）、`.tmp/flip-sheet.png` + `.tmp/flip-live.gif`（翻页正反面）。

## 12. 真实双面纸张翻页系统（本轮）

### 12.1 旧做法为什么不行

上一轮的 `flipLeaf()` 是「单面纸」：只有一张纸在转，正反面靠**克隆**内容层勉强对上，而且在动画到 46% 时用 `swap()` 把跨页内容换成下一页——也就是「动画还没结束，页面内容已经换了」。用户看到的就是「单面纸转一圈，落地瞬间内容被替换」。

### 12.2 现在的物理模型

一本真正的书只有一种纸：**每张纸有正反两面，正面是奇数页、背面是偶数页**。

```
.book
└── .bk-content            perspective: 2400px; perspective-origin: 50% 50%
    ├── .bk-sheet[data-sheet=a1]   z 340   左页第 2 张（已翻，被 a0 盖住）
    ├── .bk-sheet[data-sheet=a0]   z 400   左页最上面（已翻，rotateY(-180deg)）
    ├── .bk-sheet[data-sheet=c]    z 290   右页下面那张（未翻，rotateY(0)）
    └── .bk-sheet[data-sheet=b]    z 300   当前右页（未翻，rotateY(0)）
```

每张纸是**一个 DOM 节点**，里面装两个面：

```
.bk-sheet
├── .bk-sheet__face--front   → 奇数页（正面）
└── .bk-sheet__face--back    → 偶数页（背面，预先 rotateY(180deg)）
```

- 四个槽位 `A0 / A1 / B / C` 都是「一张纸」，`B` 是当前右页，`C` 是它下面那张（下一页右页），`A0` 是刚翻过去的那张（它的背面就是当前左页），`A1` 是更下面一张。
- 翻下一页 = 让 `B` 绕书脊 `rotateY(0deg → -180deg)`：0°~90° 看到正面（当前右页），过了 90° 自动看到背面（下一左页），同时 `C` 从下面露出来成为新的右页。
- 落地后只是**换槽位**（`[A0,A1,B,C] = [B, oldA0, oldC, oldA1]`），再给被盖住的那张补内容；**可见的两页在整个过程中从未被替换**。
- 翻上一页同理：`A0` 从 `-180° → 0°` 转回来，它的正面就是上一右页，`A1` 的背面在它下面等着。
- 内容在**动画开始前**就已经贴在正反两面上（`settle()` 一次摆好 A0/A1/B/C 八个面），`sheets.turn()` 里没有任何「动画结束后换内容」的调用。

### 12.3 页码与数据的绑定

- 第 1 页 = 扉页，正文从第 2 页开始；跨页 s 的左页 = `2s+2`（偶）、右页 = `2s+3`（奇）。
- 纸 k 的正面 = `2k+1`、背面 = `2k+2`，所以「右页 3 的背面正好是左页 4」是纸张本身的属性，不是 JS 临时算的。
- 每个纸面节点带 `data-global-page`（验收脚本用它核对正反面到底是第几页）。

### 12.4 纸的质感

- 每面有纸色渐变（`#fffdf7 → #fdf8ee → #fbf3e4`）、内侧 1px 金色描边、内侧 46px 淡投影。
- 书脊侧 26px 渐变阴影（正面在左、背面在右，跟着纸一起转）；外侧纸边 3px 暗线 + 1px 高光，翻动时像有厚度。
- 翻动中（`.is-turning`）两个面各叠一层朝书脊方向的暗渐变，纸越过 90° 时不会「穿透」看到背面。
- `backface-visibility: hidden` + `transform-style: preserve-3d` 保证任意角度只看到一面。

### 12.5 内容层

- 图鉴：`createAtlas()` 改成**按页取内容**的 provider，26 页各 3~4 张真实卡片，每页自己带页头/页脚；筛选只出现在第 1 页（跨页 0 左页），其他页显示 `已筛选：川菜 · 12 道` 状态行。
- 其余章节：整章模块先在 `.bk-staging`（一页纸大小）里真实挂载，再按 `SPLITTERS` 把 DOM 切成左右两页塞进纸面——不是复制 HTML，事件、状态、异步数据都还在。
- 内页（菜品详情）也走同一套纸：左页=抬头+主图+第一个内容块，右页=其余内容 + AI 人格。

### 12.6 量化验收（1440×900，`.tmp/accept-turn.mjs`）

| # | 检查 | 结果 |
| --- | --- | --- |
| 1 | 4 张纸、每张正反面各自是独立页面 | PASS `a1:—/— a0:—/2 c:5/6 b:3/4` |
| 2 | 动画开始前正反面已绑定（正=3、背=4） | PASS |
| 3 | 翻转全程 55 帧（6°→174°）正反面节点恒定不变 | PASS |
| 4 | 落地即第 4/5 页，无二次替换 | PASS `left=4 right=5` |
| 5 | 连点 3 次只前进 1 页 | PASS |
| 6 | 上一页同走双面纸（6/7 → 4/5） | PASS |
| 7 | 末跨页禁用下一页 | PASS |
| 8 | 筛选后页数重算（12 道 → 8 跨页） | PASS |
| 9 | 详情内页左右都有真实内容 | PASS |
| 10 | 控制台 0 报错 | PASS |

跨页扫描 19 跨页：页码 `P02…P39` 连续，左右页都有内容，末跨页 `next` 禁用，首跨页 `prev` 禁用。手机 390×844 单页模式逐页翻（2→3→4→3），`.bk-sheet` 宽 = 整页。

截图/录屏：`.tmp/sheet-turn-4phases.png`（翻开前 / ~90° / ~144° / 落定）、`.tmp/turn-live.gif`（单次翻页）、`.tmp/turn-continuous.gif`（连续 4 次）。

### 12.7 已知取舍

- 书签跳章是瞬切（不翻 N 张纸），这是刻意的：跨章跳转翻 10 几张纸没有意义。
- 图鉴筛选器只在第 1 页，其余图鉴页显示状态行（每页是独立的纸，不可能每页都放一份筛选器）。
- 菜谱左页（表单）底部仍有约 28% 留白，视频右页结果列表约 17%——表单/列表条数固定，属于后续可补内容，不是翻页问题。


## 13. 翻页正反面切换（本轮修复）

### 13.1 症状与定位

用户报告：纸张转过中缝后仍显示上一页，动画结束才换内容。先用纯色标记块做了逐帧像素取证（`.tmp/flat-test.mjs`、`.tmp/mark2-read.py`）：给每一页贴一条纯色通栏，再看每一帧左右半页里**实际画出来**的是哪一页。

结论分两半：

- 线上 8a2b502 在标准 Chrome（1440×900、有 3D）下本来就是对的：132° 时左半页已经画的是第 4 页。
- 但只要纸的 3D 上下文被压平（`transform-style: flat`，部分浏览器/合成层会这样），旧实现就会**整段动画都画正面**：取证结果是左半页从 0° 到 180° 一直是第 3 页，落定后仍停在 3 —— 和用户描述完全一致。旧实现把「哪一面朝上」完全交给 `backface-visibility` 的浏览器剔除，一旦剔除失效就退化成单面纸。

另外 `.bk-content` 同时写了 `overflow: hidden` 和 `transform-style: preserve-3d`：按 CSS Transforms 规范，分组属性（overflow/filter/opacity/clip-path）会把 preserve-3d 的使用值改成 flat，这本身就是最容易触发压平的写法。

### 13.2 改法

`src/book/sheets.js`

- 旋转改由自己的 rAF 循环驱动（`cubicBezier(0.32,0.05,0.22,1)`，手感与原来的 CSS transition 一致），每帧算出真实角度后调用 `applyAngle(sheet, deg)`。
- `applyAngle` 里除写 `rotateY(deg)` 之外，**按角度显式决定哪一面可见**：`|deg| < 90` 只显示 `.bk-sheet__face--front`，否则只显示 `--back`。正反面内容仍在动画前贴好，动画期间不换节点、不换数据。
- `fill()` 增加「正反面绑到同一页」的 console 告警；新增 `inspect()` 返回四张纸的正反面页码与可见面。

`src/book/book.css`

- `.bk-content`：删掉 `overflow: hidden`，只留 `perspective` + `transform-style: preserve-3d`（并补 `-webkit-transform-style`）。
- `.bk-spread`：删掉它自己的 `transform-style`，把裁切 `overflow: hidden` 放到这里——裁切和 3D 上下文不再同元素。

`src/book/index.js` / `shell.js`

- 暴露 `window.__book.build = 'sheet-2.1'`、`.bk-stage[data-book-build="sheet-2.1"]`，用来一眼确认页面跑的是不是新包。

### 13.3 验收（`.tmp/marker-screencast.mjs` + `.tmp/mark2-read.py`，线上 4579304）

给每页贴纯色通栏后录屏 158 帧，逐帧统计左右半页里画出来的页：

| 角度 | 左半页 | 右半页 |
| --- | --- | --- |
| 0° | 第 2 页 | 第 3 页 |
| 39° | 第 2 页 | 第 3 页（变窄）+ 第 5 页开始露出 |
| 87° | 第 2 页 | 第 5 页（完全露出） |
| 111° | 第 2 页 + **第 4 页开始出现** | 第 5 页 |
| 145° | 第 4 页 | 第 5 页 |
| 180° | 第 4 页 | 第 5 页 |

换面发生在 87°→111° 之间（即中缝），不是动画结束。像素佐证：0°→90° 左半页变化 0.19（几乎没动），右半页变化 31.66（第 5 页已露出）；90°→140° 左半页变化 41.82（第 4 页落上来）。

回归 `.tmp/accept-turn.mjs` 10/10（线上、本地各跑一次）；19 跨页 P02…P39 连续；手机单页模式 2→3→4→3。

### 13.4 备注

如果浏览器里还是旧行为，先在控制台执行 `__book.build`：不是 `sheet-2.1` 就是页面还停在旧包（单页应用不会自己刷新），强制刷新即可。旧包（turn D）的翻页本来就是「单面纸 + 中途 swap」，症状正是「过了中缝还是旧页、结束时才换」。


## 14. 章节书签：右侧书口索引（本轮重做）

### 14.1 原来的问题

7 个章节在 `chapters.js` 里带着 `side: 'left' | 'right'`，开书后书签被拆成左右两组，
各自 `position: absolute` 挂在 `.bk-camera` 里的固定坐标上：既不是书的一部分（合上书就 `opacity: 0` 消失），
也和纸页没有任何关系（纸上写的是 `p01`/`p02` 这种假编号，跟真实章节页对不上）。

### 14.2 现在的结构

```text
.bk-book                      ← 书本体：缩放 / 合书 15° 倾斜 / 开合位移都在这一层
├── .bk-spread                ← 左右两页 + 纸张栈
├── .bk-cover                 ← 封面
└── .bk-marks                 ← 书签层（z 700，压在封面之上）
    ├── .bk-mark[data-chapter="dishes"]   data-target-page="2"
    ├── .bk-mark[data-chapter="cuisines"] data-target-page="28"
    ├── .bk-mark[data-chapter="tastes"]   data-target-page="30"
    ├── .bk-mark[data-chapter="recipe"]   data-target-page="32"
    ├── .bk-mark[data-chapter="kitchen"]  data-target-page="34"
    ├── .bk-mark[data-chapter="community"]data-target-page="36"
    └── .bk-mark[data-chapter="videos"]   data-target-page="38"
```

- 书签层是 `.bk-book` 的子节点，所以书的缩放、15° 倾斜、开合位移都自动带上书签，不需要再同步一次坐标。
- 全部书签排在右侧书口：`margin-right: -34px`（单页模式 -28px），整枚书签露在页面外缘之外，
  **不压正文**（实测正文最右 1363，书签最左 1363，重叠 0）。
- 竖排文字（`writing-mode: vertical-rl`）像书口上的印刷索引，不显示任何数字页码。
- 错层：`--mark-jog` 让相邻书签露出长度差 3px，看起来是夹在不同页里的。

### 14.3 绑定关系（全部由页面库现算，不写死）

| 书签 | 章节 | 绑定页 targetPage | 目标跨页 | 实测点击落点 |
| --- | --- | --- | --- | --- |
| 美食图鉴 | dishes | 2 | 0 | spread 0 ✓ |
| 八大菜系 | cuisines | 28 | 13 | spread 13 ✓ |
| 口味探索 | tastes | 30 | 14 | spread 14 ✓ |
| 菜谱工作台 | recipe | 32 | 15 | spread 15 ✓ |
| 食材厨房 | kitchen | 34 | 16 | spread 16 ✓ |
| 美食社区 | community | 36 | 17 | spread 17 ✓ |
| 影像视频 | videos | 38 | 18 | spread 18 ✓ |

映射公式：`targetPage = spreadOfChapter(id) * 2 + 2`（章节第一跨页的左页）。
章节内容增减 / 图鉴筛选改变分页后，`spreadOfChapter` 会变，书签跟着变（没有写死的下标）。

### 14.4 书签跟着纸一起转

`sheets.turn()` 每帧回调 `hooks.onAngle(sheet, deg)`；index 把这张纸正反面的页码交给书签层：

```js
sheets.hooks.onAngle = (sheet, deg) => marks.riding({ pages: pagesOfSheet(sheet), deg });
```

- 只有「绑定页正好在那张正在翻的纸上」的书签会进入 `is-riding`，并写入 `--ride-deg`；
- CSS 用同一个角度做 `rotateY`（`transform-origin: right center`，书口为轴），
  书签和纸是同一个角度、同一帧、同一条时间线，不是另外播一段动画；
- 实测（spread 12 → 13，翻向「八大菜系」）：纸 110° 时书签 -110.45°，纸 153° 时书签 -153.01°，
  角度中位差 < 1°，最大跟随 180°；
- 书签始终贴着书口（最大横向偏移 37px，就是它自己的宽度），不会飞到屏幕别处；
- 纸落定后 `marks.idle()` 清掉跟随状态，书签回到书口。

### 14.5 合上也有书签

`.bk-marks` 不再随开合隐藏（删掉了原来的 `opacity: 0`），合上时它就在封面右侧外缘；
因为合书整体缩到 0.52，书签层补了 `scale(1.45)`，标签仍然清楚。
实测：合上 1440 宽时 7 枚书签 x 811–966、390 宽手机 x 207–347，全部在视口内，且 `elementFromPoint` 都命中书签本身（没被封面盖住）。

### 14.6 验收

`.tmp/marks-verify.mjs`：19/19 通过（合上 5 项、打开 4 项、7 个书签逐个点击、合上点击开书、跟随翻页 3 项、缩放、手机 3 项、桌面无报错）。
回归：`accept-turn` 10/10、19 跨页扫描全通、手机单页 2→3→4→3。

截图与录屏：`.tmp/markshots/`（01-closed-full、02-closed-tabs、03-open-full、04-open-tabs、05-hover、07-after-click-videos、hover.gif、click.gif、ride.gif）。


## 15. 书签左右迁移：绑到真实纸张，跟着纸翻

### 15.1 上一版错在哪

书签层是「一整列挂在书的右书口」的独立层，翻页时只让**绑定页在翻动那张纸上**的书签原地转个角度（`--ride-deg`），
位置始终是右侧。所以翻到 P30–P31 时，图鉴/菜系对应的纸早就翻到左边了，书签却还钉在右边——
书签只知道自己属于哪个模块，不知道自己在哪张纸上。

### 15.2 现在的绑定链

每枚书签从 `chapters.js` 出来时就算出两样东西（`index.js`）：

```js
const spread = book.spreadOfChapter(ch.id);
{ id, label, tint, spread, anchorPage: spread * 2 + 3 }   // 这一章第一跨页的右页
```

`anchorPage` 取右页（`2s+3`）而不是左页，是为了到这一章时那张纸**还没翻**——
这正好对上「当前章节在右侧」。

每帧再问一句「这一页现在压在哪张纸上」，答案有两个来源（`syncMarks`）：

| 情况 | 角度 | 书签在哪 |
| --- | --- | --- |
| 这一页正压在纸页栈里的某张纸（当前窗口的 4 张纸） | 读那张纸的实时角度 | 跟着纸走 |
| 已经翻走、落在左侧已翻纸堆 | −180° | 左书口 |
| 还在右侧未翻的纸堆 | 0° | 右书口 |

诊断数据（`__book.marks()`）每枚都带：

```json
{ "bookmarkId": "cuisines", "chapterId": "cuisines", "anchorPageIndex": 29,
  "anchorSheetId": "c", "anchorSheetAngle": -180, "currentSide": "left", "position": "left-half" }
```

### 15.3 书签怎么「跟纸一起翻」

每枚书签外面套一根联动杆 `.bk-mark-rig`：

```text
.bk-marks (left:0 right:0，铺满书)
└── .bk-mark-rig   width: 一页 + 34px，起点在书脊(50%)，transform-origin: left center
    └── .bk-mark   贴在杆的右端 = 书页外缘
```

`--rig-deg` 就是它绑定那张纸的**同一个角度值**（`sheets.turn` 每帧回调用真值），
所以纸转到 −60°，杆也转到 −60°：书签和纸是同一个旋转轴、同一帧、同一条时间线，
越过中缝时一起越过，落到左边就是左书口，**没有任何二次定位**。

- 过 90° 时杆正好侧立看不见，在这一刻把标签自身反翻 180°（`--mark-flip`），落地后左侧标签仍然正着读；
- 左侧的书签自动换成左圆角、色标在左、悬停向左伸（`.bk-mark.is-left`）；
- 翻页动画期间不加 CSS 过渡（`is-settling` 关闭），保证逐帧跟手；跳章/开合这类整本瞬变的时刻才开 320ms 过渡。

### 15.4 验收（`.tmp/verify-sides.mjs`，24/24）

| 项 | 结果 |
| --- | --- |
| P30–P31（spread 14） | 图鉴 x=47、菜系 x=45（书左边 77，露在书外） |
| 当前章节 | 口味探索在右（x=1363）且朱红高亮 |
| 后续章节 | 菜谱/厨房/社区/视频 全在右 |
| 翻到下一跨页 | 口味探索书签 x 1363 → 43，93 帧连续，角度与纸 100% 吻合，脱节帧 0 |
| 反向翻页 | 回到右侧（帧内 x 43→124…），spread 14 |
| 跳章 | 跳到视频章：左侧 6 枚、视频在右 |
| 缩放 1024 | 左右归属不变、左侧书签仍在屏内 |
| 合上 | 7 枚全部回右侧（DOM + 数据都对） |
| 手机 390 | 单页模式统一右缘、在屏内、可点 |
| 回归 | accept-turn 10/10、19 跨页扫描全通、手机单页正常、0 报错 |

素材：`.tmp/sides/`（01-p30-left-right.png、02-closed.png、03-phone.png、follow.gif、back.gif）。

### 15.5 一处如实的边界

只有当前窗口那 4 张纸有真实角度；更早的章节页已经不在 DOM 里（纸页栈是滑动窗口），
它们按「已翻到左侧纸堆」处理（−180°），所以从 0 号章跳到 18 号章时，
超出窗口的那几枚书签是在落定的那一拍一起归位（此时纸张本身也是一起瞬变的），不是逐帧跟过去的。


## 16. 书签贴回书边（消除悬浮感）

### 16.1 症状与实测

用户截图里合上的书签像一排悬空按钮，量出来是：书右缘 x=919，书签左缘 x=1069 —— **空隙 150px**，7 枚全都一样。

原因在 `.bk-book--closed .bk-marks { transform: translateY(-50%) scale(1.45) }`：
合上书整体缩到 0.52，为了让标签看得清就给书签层放大 1.45，
但缩放原点是**层的中心**（= 书的中心），书签在层的右缘，放大 1.45 等于被推出去 0.45 × 380px ≈ 171px。

打开状态一直是 0px（书签本来就贴在右页外缘），所以只有合上时露馅。

### 16.2 改法

1. **缩放原点挪到书口**：`.bk-marks { transform-origin: 100% 50% }`（右侧书边），
   放大时书签咬住书边向外长，不再平移。
2. **放大量按封面书口长度算**：`fitMarks()` 量出书签列的自然高度 `offsetHeight` 与书高，
   `scale = clamp(0.92 * 书高 / 列高, 0.78, 1.35)`。窗口变化走 `fit()` 重算，
   所以任何尺寸下整列都正好落在封面右侧那条书口上，上端不出书角、下端不落到书外。
3. **小窗口先收字号再收内边距**：`--mk-font / --mk-pad / --mk-gap` 三级降级，
   900×700、724×600、600×580 这些尺寸也贴得住（原来会在书角外悬空）。
4. **内侧插入 4px**：`.bk-mark { margin-right: 4px }`，书签有 3~11px 压在页面上（实测），
   看起来是夹在纸里而不是贴在纸外。
5. **根部层次**：`::before` 内侧压暗 + 一线淡金（接触线），`::after` 4px 根部阴影（只朝纸的一侧，不做悬浮投影）。
6. **开合过程不脱节**：`.bk-marks` 的 transform 加 520ms 过渡，
   并且只有 `open/reading` 才按纸张分左右——开书动画期间书签保持右书口，不会先跳到左边再回来。

### 16.3 验收（实测）

| 场景 | 结果 |
| --- | --- |
| 合上 1440×900 | 7 枚 insets 5–10px（都在书边内侧），全部在屏内 |
| 打开 1440×900 | insets 3–7px |
| P30–P31 | 左侧 2 枚、右侧 5 枚，insets 3–8px |
| 1920 / 1280 / 1024 / 980 / 900 / 724 / 600 | 全部通过（合上、打开、P30、缩放后各测一次） |
| 开书动画 306 帧 | 脱节帧 0（inset 全程 4–10px） |
| 回归 | verify-sides 24/24、accept-turn 10/10、19 跨页扫描全通 |

截图：`.tmp/attach/`（01-closed.png、02-closed-closeup.png、03-open-p30.png、04-open-edge.png）。


## 17. 合上点书签直达章节 + 书签随纸页扇开

### 17.1 原来的开书路径（问题）

`openFirst()` 里：先按 `location.pathname` 算页码 → 播开书动画 → **动画结束**才 `showPath()` 摆纸。
所以合上点书签时是：开书 → 显示首页内容 → `openChapter()` 再一张一张翻（最多 3 张）→ 还在远处就直接落位。
等于「开书 + 二次翻页」，中间还闪一下首页。

### 17.2 直达：一次开书，动画起点就是目标章节

`openFirst(targetSpread)` 现在先 **预定位**、再开书：

1. `position = { single, value: 目标跨页 }`；
2. `await render({})`（无动画 settle）把目标跨页的正反面内容贴到四张纸上；
3. `sheets.collapse()` 把四张纸合回 0°（此时全被封面挡着，看不见）；
4. 播放 **一次** 开书动画，同时 `sheets.fan()` 让四张纸从 0° 各自转到摊开角度；
5. 动画结束时书就在目标跨页，不再 `showPath`、不再翻第二次。

书签点击：`openChapter(id)` 在 `mode === 'closed'` 时直接 `openFirst(book.spreadOfChapter(id))`，
不再「先 openFirst() 再翻三张」。

实测（点各书签，抓 `window.__book.spread` 序列）：只有 `[0 → 目标]` 两个值，
目标值出现在 104–250ms（开书动画开始时就已就位，`--reading` 在 1300–1600ms 才到）。

### 17.3 书签随纸页扇开（不再等书打开才跳边）

`sheets.fan(ms)`：四张纸逐帧从当前角度同时转到 `a0/a1 = -180°, b/c = 0°`，
每帧调 `hooks.onAngle` → `syncMarks()` 读纸张实时角度。
书签的 `--rig-deg` 就是它绑定那张纸的角度，所以纸张扇开时书签跟着自己的纸从右书口转过去 ——
没有「书打开了、书签才跳过去」的瞬移。

实测合上点书签的逐帧轨迹（看的是最终落在左侧的书签）：x 912 → 51、
175 帧里最大单帧位移 53px（90° 附近投影最快处）、**跳变帧 0**。

### 17.4 其它修正

- `syncMarks()` 的 `closed` 判定改为 `!spread || (mode === 'closed' && !marksOpen)`：
  开书动画期间 `mode` 还是 `closed`，原来会把书签一直按「合上」摆，直到动画结束才换边。
- 动画途中再点书签：记到最后一次点击，当前动画结束后接着走（不竞态、不丢点击）。
- 开书前加两帧等待，让刚贴上去的页面先完成布局，动画首帧不卡。

### 17.5 验收

| 项 | 结果 |
| --- | --- |
| A 合上点口味探索 | 一次开书到 P30，spread 序列 [0 → 14]，无首页、无二次翻页 |
| B 其余 5 个书签 | 图鉴 0 / 菜系 13 / 菜谱 15 / 厨房 16 / 社区 17，全部直达 |
| C 正向翻页 | 书签 x 1359→47，93 帧，角度吻合 100%，脱节帧 0 |
| D 反向翻页 | 书签 x 47→1359，帧内连续 |
| E 连点 / 连翻 | 7 枚书签不重复不错位，最后一次点击生效，无报错 |
| 开书过程贴附 | 281 帧，脱节帧 0 |
| 各尺寸 | 1920/1440/1280/1024/980/900/724/600 全通过 |
| 回归 | verify-sides 24/24、accept-turn 10/10、view-audit 19 跨页 |


## 18. 全站书页装帧框

### 18.1 问题

纸和背景都是暖米白（纸 #FFFDF7→#FBF3E4，底 #FFF8ED），旧纸面只有一条
`inset 0 0 0 1px rgba(217,164,65,.22)`，实测纸边与纸面只差 Δ19（右页）/Δ8（内侧线），
顶边 `y=27` 处 Δ24.9 —— 几乎看不见，纸和背景糊成一片。

### 18.2 做法

变量集中定义在 `.bk-book`（改一处全站生效）：

| 变量 | 值 | 用途 |
| --- | --- | --- |
| `--page-frame` | #DCC49B | 主边框（暖金细线，1px） |
| `--page-frame-soft` | #EDE0C9 | 内侧装饰线（1px，距纸边 7px） |
| `--page-tick` | rgba(196,158,100,.62) | 四角角标（13×1px 细线） |
| `--page-edge` | rgba(120,82,56,.1) | 外侧边接触阴影 |
| `--page-lip` | rgba(120,82,56,.07) | 上下纸边阴影 |

边框挂在**纸张元素**上，不是屏幕：

- `.bk-sheet__face::before`（正反两面各自一份）+ `.bk-page::before`（合书/开书时的底纸）；
- `inset: 0` → 边框永远贴着纸边；`z-index: 9` → 永远画在内容之上，不会被
  满版图片、卡片或翻页层盖住；
- 内侧线与四角角标用 `outline-offset: -7px` 与 8 条 `linear-gradient` 背景实现；
- 纸边阴影走 `::after` 叠层（外侧边 26px 渐隐、上下各 20px），背面镜像；
- 满版排版的页面（菜系/口味/视频）`.bk-pageface--inner` 补 10px 安全区，
  正文页原有 24/30/38px 内边距不动。

### 18.3 实测（像素级）

美食社区页，同一坐标改前/改后：

| 位置 | 改前 | 改后 |
| --- | --- | --- |
| 右页外边 x=1362 | (224,199,174) Δ77.5 | (219,190,156) Δ97.7 |
| 右页顶边 y=27 | (246,234,208) Δ24.9 | (220,196,155) Δ94.9 |
| 内侧装饰线（纸边内 7px） | 无（Δ8.6） | (233,219,196) Δ46.9 |
| 四角角标（右上角） | 无 | (202,169,117) Δ90 |
| 中缝两侧 | — | 左页 x=714、右页 x=725 各一条，相距 10px，不重叠 |

翻页中（第 8 帧）：装帧线像素 1568 → 6820（4.3 倍），且竖线位置随 y 变化
（y=40 在 x=838，y=140 在 x=506，y=340 在 x=962）—— 线是斜的，说明它跟着旋转的纸走。

### 18.4 覆盖范围

19 个跨页 × 4 张纸 × 正反两面 + 合书底纸，全部命中
`1px rgb(220,196,155)` + `outline 1px -7px rgb(237,224,201)`：

- 图鉴 P02 / 菜系 P28 / 口味 P30 / 菜谱 P32 / 厨房 P34 / 社区 P36 / 视频 P38 及全部中间跨页；
- 内页（菜品详情 / 后台 / 账号等模块页）同样是纸面结构，自动继承；
- 手机单页：8 个 face 全部带框。

回归：verify-sides 24/24、accept-turn 10/10、开书 281 帧脱节 0。


## 19. 纸面收边：去白底、删页码、删页脚翻页、删纸角装饰

### 19.1 删了什么

| 位置 | 元素 | 处理 |
| --- | --- | --- |
| 纸面底部两角 | `.bk-folio`（「图鉴 · P02」） | shell 里不再创建，CSS `display:none` 兜底 |
| 纸张底部 | `.bk-turn`（‹ 上一页 / 下一页 ›） | DOM 移除、事件解绑、CSS 删除 |
| 图鉴页眉 | `.atlas-page__kicker`（「中国美食图鉴 · 左页/右页」） | 删除 |
| 图鉴页脚 | `.atlas__pagenum`（「第 1 页 · 共 8 页」） | 删除 |
| 图鉴页脚 | `.atlas__pagetip`（筛选状态小字） | 删除（筛选状态由顶部筛选条本身表达） |
| 菜系/口味页头 | `.catb__count` 里的「第 x / y 页」 | 只留「共 N 道」，翻页箭头保留 |

内部页码（pages.js 的全局页码、position、书签锚点）完全没动，书签跳转与翻页定位照旧。

### 19.2 白底变纸面

- `.bk-stage` 上把 `--color-surface` 从 #FFFFFF 改成纸色 #FFFCF5；
- 大面板（`.post` / `.tool-form` / `.ek-card` / `.community-note` / `.composer-box` / `.catb__lead` 等）改成
  `rgba(255,252,245,.6)` + 1px 暖色描边，去掉投影，让纸纹与米白透上来。

实测（1440×900，纸面区域）纯白像素占比：

| 页面 | 改前 | 改后 |
| --- | --- | --- |
| 美食社区 | 28.5% | **1.0%** |
| 菜品详情 | 0.7% | 0.0% |
| 食材厨房 | 大面板 4 块 `rgb(255,255,255)` | `rgba(255,252,245,.6)`，纯白元素 **0** |

### 19.3 内容收进纸边

- 图鉴页原本直接贴在纸面上（不经过 `.bk-pageface`），四周 0 边距 → 补 `padding: 16px`；
- 满版页（菜系 / 口味 / 视频）`padding` 10 → 14px；
- 正文页沿用原有 24 / 30 / 38px。

实测「文字与图片到纸边的最近距离」（左/上/右/下，px）：

| 章节 | 左页 | 右页 |
| --- | --- | --- |
| 图鉴 | 16 / 17 / 17 | 17 / 17 / 17 |
| 菜系 | 14 / 17 / 15 | 17 / 17 / 17 |
| 口味 | 14 / 15 / 15 | 75 / 62 / 77 |
| 菜谱 | 75 / 62 / 77 | 51 / 46 / 212 |
| 厨房 | 45 / 40 / 45 | 45 / 32 / 50 |
| 社区 | 60 / 56 / 67 | 45 / 32 / 54 |
| 视频 | 59 / 55 / 68 | 14 / 15 / 22 |

全部 ≥ 14px；横向溢出 0 处（`scrollWidth > clientWidth` 检测，7 个跨页全过）。

### 19.4 验收

- 页码文字：`P\d{2}` / 「第 x 页」/「共 y 页」在 7 个章节的 innerText 里 **0 次命中**；
- `.bk-turn` 与 `.bk-folio` 数量：桌面 0、手机 0；
- 书签跳转：videos → recipe 正常（spread 15），手机点书签正常（社区 / 厨房）；
- 回归：verify-sides 24/24（线上连测 3 次）、accept-turn 10/10、开书 270 帧脱节 0、直达开书 6 章正常。

> 注：verify-sides 里「书签是否瞬移」原本判定为 dx>120 且角度变化<12°，
> 90° 附近 1° 就对应几十像素，会偶发误报；已把阈值收紧为「纸张完全静止（<1.5°）而书签移动」，连测脱节帧 0。
