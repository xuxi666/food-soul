# 社区模块双页联动改造 · 交付与验收记录

> 2026-11-11 · 本地工作副本（未 commit / 未推送 / 未部署）
> 范围：社区帖子详情从居中弹层改为**左页内联**；关联菜品「和某某聊聊」把**右页**切到既有双页聊天，收起后右页恢复社区浏览。
> 原则：社区首页不动、聊天系统不重写、帖子/评论库不新增、无关模块不改。

## 1. 结论

| 项 | 结果 |
| --- | --- |
| 详情进左页，画册不关 | 通过（PC 双页 `detail face=3 / list face=5`；无 `.post-detail` 浮层） |
| 右页「和菜聊聊」复用双页聊天 | 通过（`dish:<id>` 上下文、聊天面板铺满右页，桌面 `dm-chat--right`） |
| 收起聊天回列表、详情保留 | 通过（列表滚动 120 → 120；左侧详情仍在） |
| 返回社区恢复排序 / 滚动 | 通过（热门 tab 保留，`scrollTop 200 → 200`） |
| 平板 / 手机单页回退 | 通过（1024×768 双页；768×1024、390×844 单页详情 + 整页聊天） |
| 构建 | `vite build` 成功（`dist/assets/index-B9bbfKv4.css`、`index-CvlPvFuv.js`） |
| 数据清理 | 已恢复 `data/community.json` 与举报表；当前 13 条可见帖、1 条历史举报，无验收残留 |

## 2. 交互对照

| 场景 | 改造前（HEAD `11937f4`） | 改造后 |
| --- | --- | --- |
| 点帖子 | 居中弹窗 + 背景压暗模糊，画册被盖住 | 详情贴在**左页**，右页列表原样保留；无遮罩、无模糊、无悬浮全局返回 |
| 聊关联菜 | 弹窗里「聊一聊」是整页链接，点击后离开阅读（实测落到封面 / 闭书） | 「和宫保鸡丁聊聊」把**右页**换成该菜聊天；左页详情不动 |
| 收起聊天 | 无（已离开画册） | 「收起聊天」回到右页社区列表，左页详情保留 |
| 返回 | 弹窗右上角 × | 左页顶部「← 返回社区」；Esc 仅退详情/大图，不合书 |

改前截图：`shots/before-detail-modal.png`、`shots/before-chat-page.png`
改后截图：`shots/final-pc-detail.png`、`shots/final-pc-chat.png`、`shots/final-pc-chat-closed.png`、`shots/final-pc-back.png`

## 3. 改动文件（4 个）

| 文件 | 改动 |
| --- | --- |
| `src/views/community.js` | 详情由 `<body>` 弹层改为挂到 `.com-detail`（左页）；新增返回条、动态菜品卡/按钮；评论重画读实时 `post.comments`；Esc 只关大图/详情；打开新帖或返回时按现有逻辑收起聊天 |
| `src/book/pages.js` | `SPLITTERS.community` 双页分支把 `.com-detail` 一起分到左页；单页分支仍整章一张纸 |
| `src/book/chat-panel.js` | 聊天面板挂载前把已滚动的纸面归零，收起后按记录恢复列表滚动；面板始终铺满纸面可视区 |
| `src/styles/community.css` | 删除旧弹层样式，新增左页详情、返回条、菜品卡、聊天按钮；`.community-side` 让位；单页隐藏列表与章节页头；图片裁在纸内 |

没有新增数据表、字段、接口；`data/community.json`、`data/foodsoul.db` 结构未改。

## 4. 数据 / 接口核对（任务书检查点）

| 检查点 | 实测 |
| --- | --- |
| 帖子列表 / 总数 | `GET /api/posts?sort=latest&page=1&pageSize=12` → 200，12 条、`total=13`、`hasMore=true`；第 2 页取到剩余 1 条 |
| 帖子详情字段 | 列表项含 `author/createdAt/content/images/kind/likes/likedBy/comments/recipe/dishId`；真实关联帖 `20dc0e09…` → `dishId=gongbaojiding`、1 张图、1 条评论 |
| 图片 | 帖子图片走 `/uploads/*`；详情内多图（验收测试帖 2 图）全部落在左页内（`right - faceRight = -30px`），可点开大图，Esc 只关大图 |
| 点赞 | `POST /api/posts/:id/like` → 200，计数 0→1、按钮 `is-on`；再点可取消 |
| 评论 | `POST /api/posts/:id/comments` → 201，列表 0→1、评论数同步、输入框清空、toast「已评论」 |
| 举报 | `POST /api/posts/:id/report` → 201，表单收起；重复举报同一帖返回 429（服务端既有去重，不是前端故障） |
| 关联菜品数据 | `GET /api/dishes/gongbaojiding` → 200：`name/nameEn/cuisine/tastes/image/intro/personality`；前端 `DISH_BY_ID` 与发帖下拉同源（97 道），无猜测、无随机菜 |
| 聊天上下文 / 历史 | 面板 `data-context=dish:gongbaojiding`；换菜为 `dish:mapo-tofu`，文本不串台；重新打开同菜历史恢复；切侧栏书签再回来历史仍在 |
| 权限 / 保存 | 浏览无需登录；点赞/评论/举报/发图需登录（admin 会话）；帖子与评论仍存服务端 `community.json`，刷新后仍在 |

## 5. 自动化验收

### 5.1 PC 双页（1440×900，`accept.mjs`，33/33 通过）

覆盖：首页原样、详情进左页、字段完整、图片裁切/大图、点赞、评论、举报、聊天开在另一页、动态欢迎语、快捷问题、多轮回复、收起聊天、滚动恢复、换菜隔离、历史恢复、返回社区、Esc、侧栏书签、无脚本异常。

### 5.2 响应式（`accept-responsive.mjs`，30/30 通过）

| 设备 | 详情 | 聊天 | 收起 / 返回 |
| --- | --- | --- | --- |
| 1024×768 双页 | 左页 384/444，右页列表 | `dm-chat--right` 铺满右页 | 列表 12 条；返回后正常 |
| 768×1024 单页 | 610/670，列表让位 | `dm-chat--full` | 回详情；返回列表 |
| 390×844 单页 | 246/306，无横向溢出 | `dm-chat--full`，输入框贴底 | 回详情；返回列表 |

三端均无 `documentElement.scrollWidth` 溢出、无页面脚本异常。

### 5.3 补充边界（`accept-edge.mjs` / `accept-sort.mjs` / `accept-bookmark.mjs`）

- 无 `dishId` 帖子：详情正常，菜品卡与聊天按钮都不渲染（没有假按钮）。
- 详情超长：临时插入 1200px 内容后纸面可滚（`scrollTop` 0→500，可滚余量 1081px），内容不被裁死。
- 键盘：Shift+Enter 只换行（`'第一行\n第二行'`，消息数 0→0）；Enter 发送（消息数 0→2，输入框清空）。
- 排序/滚动：热门 tab 下 `scrollTop 200 → 开详情 → 返回` 仍为热门、200。
- 书签优先：聊天中切「图鉴」→ 聊天关闭、章节切换；回「社区」重进同菜，历史仍在。

## 6. 截图清单（`shots/`）

- 改前：`before-community.png`、`before-detail-modal.png`、`before-chat-page.png`
- PC：`final-pc-community.png`、`final-pc-detail.png`、`final-pc-chat.png`、`final-pc-chat-reply.png`、`final-pc-chat-closed.png`、`final-pc-back.png`、`final-pc-sort-restored.png`、`final-pc-bookmark-chat-restored.png`、`final-pc-chat-enter.png`
- 平板：`final-tablet-detail.png`、`final-tablet-chat.png`、`final-tablet-chat-closed.png`、`final-tablet-back.png`
- 手机：`final-phone-detail.png`、`final-phone-chat.png`、`final-phone-chat-closed.png`、`final-phone-back.png`
- 一次性测试数据验收图（测试帖与评论已清理）：`community-dual-detail.png`、`community-dual-chat.png`、`community-dual-chat-closed.png`、`community-dual-chat-other.png`、`community-dual-chat-restored.png`、`community-dual-back.png`

## 7. 已知限制与遗留

1. **数据模型只支持单菜品**：帖子只有 `dishId`（无 `dishIds`），所以不存在「多菜品选一个」的分支；没有擅自合并或只取第一条。若未来加多菜品字段，需要在这里补选择策略。
2. **菜品卡数据源**：用前端 `DISHES`（与发帖下拉同源，97 道）；DB 里 43 道「生成菜品」不能从社区发帖关联，因此不会出现查不到卡片的真实帖子。
3. **聊天实例缓存上限**：沿用现有 `MAX_CACHED=3`，第 4 道菜会淘汰最早实例（跨菜切换仍隔离，历史可能被淘汰）。
4. **生成中切换菜品**：切换会立即收起面板，上下文按 `dish:<id>` 隔离；未对「流式生成中断时序」做逐帧断言。
5. **真机软键盘**：headless 只能验证输入框贴聊天页底（composer bottom = face bottom），未在真机验证键盘弹起时 `dvh` 行为。
6. **重复举报**：服务端对同一用户同一帖只保留一条待处理，重复提交返回 429；前端保留表单并提示，这是既有策略。
7. **社区没有搜索框**：现有 UI 只有 最新/热门/讨论最多 + 无限滚动；「搜索状态」无对应控件可恢复，排序与滚动已按上面验证。
8. 旧版 `/chat/:id` 整页聊天仍作为「画册未接管」时的 fallback 保留；在书内不会触发。

## 8. 部署状态

- 分支工作区基于 `11937f4`，仅有上述 4 个文件改动；**未 commit、未推送 GitHub、未部署线上**。
- 本地开发服 `http://127.0.0.1:5180` 运行中；验收结束后测试帖、举报、评论已清理，`community.json` 已还原。