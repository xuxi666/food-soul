# 后台管理（/admin）模块台账与修复记录

> 2026-11 巡检与修复。所有结论来自本机真实运行的后端（`server/*.mjs` + `data/foodsoul.db`），
> 没有自建 AI、没有自建风味引擎，Epicure 一律标注为「外部 MCP」。

## 1. 入口与权限

| 项 | 事实 |
| --- | --- |
| 地址 | `/admin`（画册内页；地址带 `/admin` 时需先点封面翻开画册） |
| 登录 | 复用站点账号；管理员由环境变量 `ADMIN_EMAILS` 白名单决定，每次请求 `syncRole()` |
| 会话 | Cookie `fs_session`（`HttpOnly; SameSite=Lax`） |
| 拦截 | 未登录 → 401 `auth_required`；已登录非管理员 → 403 `forbidden`；`sameOrigin()` 先于权限校验 |
| 测试账号 | 本地 `admin@foodsoul.local` / `AdminPass1234!`（见 `.env`） |

## 2. 模块清单（A 可用 / B 不完整 / C 有故障 / D 缺失 / E 外部依赖不可判）

| 模块 | 结论 | 说明 |
| --- | --- | --- |
| 后台概览 | A | 5 项真实 DB 计数 + 内置 AI 状态 + Epicure 外部服务状态 + 最近审计 |
| 社区内容 | A | 列表/关键词/分类/时间/状态/只看被举报、详情、编辑正文与分类、隐藏、恢复、删除、分页 |
| 美食图鉴 | A | 搜索、按菜系筛选、详情（口味/难度/份量/主料/简介）、换图、复位 |
| 内置 AI | A | 多套配置、启用、测试连接、删除；Key 只存服务端、浏览器只见掩码 |
| 举报处理 | A | 状态筛选、理由计数、处理说明、处理中/已处理/驳回、确认违规并删除内容 |
| 审计日志 | A（仅概览内最近 12 条） | 独立页面未做（D） |
| 用户与角色 | D | 无用户列表/禁言/改角色接口与页面 |
| 系统设置 | D | 无站点设置页（配置在 `.env` 与服务端） |
| 待审核帖子 | D | 帖子发布即公开，数据模型只有软删除（`deletedAt`），没有 pending 状态；概览用说明文字代替假队列 |
| 菜品新建 / 删除 / 改分类 / 改文案 | D | 菜品来自 `src/data/dishes.js` 静态数据源；后台只有图片覆盖表 |
| Epicure 能力调用（network/autoadd/analyze/create/pair） | B | 服务端已有接口，后台没有调用入口；本轮只做「状态探测」 |

## 3. 接口（`/api/admin/*`，全部经 `sameOrigin` + `requireAdmin`）

- `GET /overview` — `stats{users,posts,reports,dishes,ai}`、`services{ai,epicure}`、`recentAudit`
- `GET /service-health?probe=1` — 真实探测 Epicure（≤12s）并写 `service_health` 表
- `GET /posts` — 支持 `q,page,pageSize,status(visible|deleted),kind,from,to,reported`
- `POST /posts/:id` — 编辑正文（≤2000）与分类；`DELETE /posts/:id` 软删；`POST /posts/:id/restore` 恢复
- `GET /dishes?q&cuisine` / `POST /dishes` / `DELETE /dishes/:id`
- `GET /reports?status` / `POST /reports/:id/handle`（`processing|resolve|reject|delete-post` + `note`≤200）
- `POST /upload` — 类型/大小校验，限流 20 次/小时/管理员
- `GET /audit`

## 4. 内置 AI 与 Epicure 的区分

- **内置 AI（本站能力）**：`built-in-ai`，来自 `ai_configs`，主开关 + 当前配置 + Key 是否存在 + 最近测试结果。
  浏览器永远拿不到明文 Key；「关闭」显示为不可调用，绝不显示「在线」。
- **Epicure（外部 MCP）**：`epicure`，来自 `diagnoseEpicure()`：
  `dropClient → listTools → callTool('list_targets')`，结果写 `service_health`（成功只更新 `last_ok_at`，
  失败只更新 `last_fail_at`）。错误分类：`disabled|dns|refused|timeout|tunnel|auth|rate-limit|http-5xx|http-4xx|network`；
  Cloudflare 隧道/1033/522/523/530 归入 `tunnel`（外部通道问题，不是 AI Key 问题）。

## 5. 右页空白的根因（已修）

DOM 一直在（`.admin-content` 有宽高、数据也渲染了），但容器计算样式是 `opacity:0; transform:translateY(6px)`。
原因是后台入场动画用了类名 `is-swapping`，而全局 `src/styles/home.css` 里 `.is-swapping` 是「切换中」过渡态，
且 `animateIn()` 只加不减，类名永久留在容器上。修复：

1. 类名改为 `is-entering`（`src/views/admin.js`），动画只作用于子节点（`src/styles/admin.css`）；
2. 动画结束（`animationend`）后立刻摘掉类名，并留 900ms 兜底 —— 以后任何同名全局规则都不会再把右页隐藏。

## 6. 首页图片功能（已移除）

`/api/assets/overrides` → `src/lib/overrides.js` 这条链路原本同时喂「菜系/口味卡图」和「菜品图」。
卡图唯一的消费方是旧首页 3D 转盘（`src/views/home.js` + `src/gallery.js`），转盘于 2026-11-11 删除后，
后台「首页图片」模块再也没有可见效果。为避免保留无效操作，本轮一并下线：页签、`/api/admin/cards` 接口、
`cardRows()`、`setCardOverrides()`、`src/data/wheel.js` 与 `card_images` 读写函数全部移除。

- `card_images` 表与历史数据保留（不删数据、不迁移），只是不再被读写；
- `GET /api/assets/overrides` 现在只返回 `{ dishes, updatedAt }`；
- 菜品换图仍然真实可见：菜系页与菜品详情页都读同一份 `DISHES.image`。

## 7. 复现测试

- 接口：`node scripts/verify-admin.mjs`（44 项：权限 / 计数 / 探测 / 帖子 / 举报 / 图鉴 / 上传 / 已下线的首页图片接口返回 404）
- 界面：`BASE=http://127.0.0.1:5180 node scripts/verify-admin-ui.mjs`（29 项：PC 1440×900 / 平板 834×1112 / 手机 390×844）
- 截图：`docs/admin-shots/`（已按当前界面重新生成，首页图片模块的旧截图已删除）

> 测试产生的帖子/举报/账号/上传文件在脚本末尾清理；`card_images` 历史数据未删除。