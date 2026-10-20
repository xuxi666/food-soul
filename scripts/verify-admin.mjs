// 管理后台接口验收：权限隔离、社区删除、图片覆盖、举报处理
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:5180';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@foodsoul.local';
const ADMIN_PASS = 'AdminPass1234!';
const UPLOAD_DIR = path.resolve('public/uploads');

const results = [];
const check = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}${extra ? ' | ' + extra : ''}`);
};

async function req(pathname, { method = 'GET', body, cookie = '', headers = {} } = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: BASE,
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.getSetCookie?.() || [];
  const sess = sc.find((x) => x.startsWith('fs_session='));
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data, cookie: sess ? sess.split(';')[0] : '' };
}

async function loginOrRegister(email, password, name) {
  const reg = await req('/api/auth/register', { method: 'POST', body: { email, password, name } });
  if (reg.status === 200) return { cookie: reg.cookie, user: reg.data?.user };
  const login = await req('/api/auth/login', { method: 'POST', body: { email, password } });
  return { cookie: login.cookie, user: login.data?.user };
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const stamp = Date.now();

/* ---------- 1. 匿名 ---------- */
const anonOverview = await req('/api/admin/overview');
check('未登录访问后台接口返回 401', anonOverview.status === 401, `HTTP ${anonOverview.status}`);
const anonCards = await req('/api/admin/cards');
check('未登录读取卡片配置返回 401', anonCards.status === 401, `HTTP ${anonCards.status}`);
const anonDelete = await req('/api/admin/posts/seed-post-1', { method: 'DELETE' });
check('未登录删除帖子返回 401', anonDelete.status === 401, `HTTP ${anonDelete.status}`);

/* ---------- 2. 普通用户 ---------- */
const normalEmail = `admin-t-normal-${stamp}@example.com`;
const normal = await loginOrRegister(normalEmail, 'Normal1234!', '普通用户');
check('普通用户登录成功', Boolean(normal.cookie), `HTTP user=${normal.user?.role}`);
check('普通用户 role 为 user', normal.user?.role === 'user', String(normal.user?.role));

const normalOverview = await req('/api/admin/overview', { cookie: normal.cookie });
check('普通用户访问概览返回 403', normalOverview.status === 403, `HTTP ${normalOverview.status}`);
const normalDelete = await req('/api/admin/posts/seed-post-1', { method: 'DELETE', cookie: normal.cookie });
check('普通用户删除帖子返回 403', normalDelete.status === 403, `HTTP ${normalDelete.status}`);
const normalCard = await req('/api/admin/cards', { method: 'POST', cookie: normal.cookie, body: { kind: 'cuisine', id: 'chuan', url: '/dishes/mapo-tofu.jpg' } });
check('普通用户改卡片图片返回 403', normalCard.status === 403, `HTTP ${normalCard.status}`);
const normalUpload = await req('/api/admin/upload', { method: 'POST', cookie: normal.cookie, body: { image: PNG } });
check('普通用户调用管理上传返回 403', normalUpload.status === 403, `HTTP ${normalUpload.status}`);

/* ---------- 3. 管理员 ---------- */
const admin = await loginOrRegister(ADMIN_EMAIL, ADMIN_PASS, '管理员');
check('管理员登录成功', Boolean(admin.cookie));
check('管理员 role 为 admin', admin.user?.role === 'admin', String(admin.user?.role));

const overview = await req('/api/admin/overview', { cookie: admin.cookie });
check('管理员可读概览', overview.status === 200 && Boolean(overview.data?.stats), `HTTP ${overview.status}`);
check('概览包含帖子/举报/卡片/菜品统计',
  Boolean(overview.data?.stats?.posts && overview.data?.stats?.reports && overview.data?.stats?.cards && overview.data?.stats?.dishes));

/* ---------- 4. 社区管理 ---------- */
const postText = `后台测试帖 ${stamp}`;
const created = await req('/api/posts', { method: 'POST', cookie: normal.cookie, body: { content: postText } });
check('普通用户发帖成功', created.status === 201, `HTTP ${created.status}`);
const postId = created.data?.post?.id;

const adminPosts = await req(`/api/admin/posts?q=${encodeURIComponent('后台测试帖')}`, { cookie: admin.cookie });
check('管理员可按关键词搜到帖子', adminPosts.status === 200 && adminPosts.data.items.some((p) => p.id === postId), `命中 ${adminPosts.data?.items?.length ?? 0} 条`);

const detail = await req(`/api/admin/posts/${postId}`, { cookie: admin.cookie });
check('管理员可查看帖子详情', detail.status === 200 && detail.data?.post?.id === postId, `HTTP ${detail.status}`);

const del = await req(`/api/admin/posts/${postId}`, { method: 'DELETE', cookie: admin.cookie, body: { reason: '验收测试删除' } });
check('管理员删除帖子成功', del.status === 200, `HTTP ${del.status}`);

const afterDel = await req(`/api/admin/posts?q=${encodeURIComponent('后台测试帖')}`, { cookie: admin.cookie });
check('删除后管理列表不再出现', !afterDel.data.items.some((p) => p.id === postId));
const publicList = await req('/api/posts?sort=latest&page=1');
check('删除后前台列表不再出现', !(publicList.data?.items || []).some((p) => p.id === postId));
const detailAfter = await req(`/api/admin/posts/${postId}`, { cookie: admin.cookie });
check('软删除保留原记录（可审计）', detailAfter.data?.post?.deletedAt > 0, `deletedAt=${detailAfter.data?.post?.deletedAt}`);

/* ---------- 5. 首页卡片图片 ---------- */
const cards = await req('/api/admin/cards', { cookie: admin.cookie });
check('卡片列表含 8 菜系 + 8 口味', cards.status === 200 && cards.data.items.filter((c) => c.kind === 'cuisine').length === 8 && cards.data.items.filter((c) => c.kind === 'taste').length === 8,
  `cuisine=${cards.data?.items?.filter((c) => c.kind === 'cuisine').length} taste=${cards.data?.items?.filter((c) => c.kind === 'taste').length}`);

const chuan = cards.data.items.find((c) => c.kind === 'cuisine' && c.id === 'chuan');
const targetUrl = chuan.defaultImage;

const saveCard = await req('/api/admin/cards', { method: 'POST', cookie: admin.cookie, body: { kind: 'cuisine', id: 'chuan', url: targetUrl } });
check('管理员保存菜系卡片图片', saveCard.status === 200, `HTTP ${saveCard.status}`);

const overrides = await req('/api/assets/overrides');
check('公开覆盖接口返回该卡片', overrides.data?.cards?.cuisine?.chuan === targetUrl, JSON.stringify(overrides.data?.cards?.cuisine));

const badCard = await req('/api/admin/cards', { method: 'POST', cookie: admin.cookie, body: { kind: 'cuisine', id: 'chuan', url: '/../../etc/passwd' } });
check('非法图片路径被拒绝', badCard.status === 400, `HTTP ${badCard.status} ${badCard.data?.error || ''}`);

const badKind = await req('/api/admin/cards', { method: 'POST', cookie: admin.cookie, body: { kind: 'hack', id: 'chuan', url: targetUrl } });
check('非法卡片类型被拒绝', badKind.status === 400, `HTTP ${badKind.status}`);

// 只影响目标卡片
const tasteNodes = await req('/api/admin/cards', { cookie: admin.cookie });
const tasteOverride = tasteNodes.data.items.filter((c) => c.kind === 'taste' && c.overridden);
check('替换菜系不影响口味卡片', tasteOverride.length === 0, `口味已覆盖 ${tasteOverride.length} 个`);

const resetCard = await req('/api/admin/cards/cuisine/chuan', { method: 'DELETE', cookie: admin.cookie });
check('恢复默认卡片图片', resetCard.status === 200);
const afterReset = await req('/api/assets/overrides');
check('恢复后覆盖消失', !afterReset.data?.cards?.cuisine?.chuan);

/* ---------- 6. 美食图鉴 ---------- */
const dishes = await req('/api/admin/dishes?q=麻婆&page=1', { cookie: admin.cookie });
check('图鉴搜索可用', dishes.status === 200 && dishes.data.items.length >= 1, `命中 ${dishes.data?.items?.length ?? 0}`);
const mapo = dishes.data.items[0];

const saveDish = await req('/api/admin/dishes', { method: 'POST', cookie: admin.cookie, body: { id: mapo.id, url: mapo.defaultImage } });
check('管理员保存菜品图片', saveDish.status === 200, `HTTP ${saveDish.status}`);
const dishOverrides = await req('/api/assets/overrides');
check('菜品覆盖写入成功', dishOverrides.data?.dishes?.[mapo.id] === mapo.defaultImage, JSON.stringify(dishOverrides.data?.dishes));

const badDish = await req('/api/admin/dishes', { method: 'POST', cookie: admin.cookie, body: { id: 'not-a-dish', url: mapo.defaultImage } });
check('不存在的菜品被拒绝', badDish.status === 404, `HTTP ${badDish.status}`);

const resetDish = await req(`/api/admin/dishes/${mapo.id}`, { method: 'DELETE', cookie: admin.cookie });
check('恢复默认菜品图片', resetDish.status === 200);

/* ---------- 7. 举报 ---------- */
const reportPostText = `待举报内容 ${stamp}`;
const reportTarget = await req('/api/posts', { method: 'POST', cookie: normal.cookie, body: { content: reportPostText } });
const reportPostId = reportTarget.data?.post?.id;
check('准备被举报的帖子', Boolean(reportPostId));

const anonReport = await req(`/api/posts/${reportPostId}/report`, { method: 'POST', body: { reason: '垃圾广告' } });
check('未登录举报返回 401', anonReport.status === 401, `HTTP ${anonReport.status}`);

const userReport = await req(`/api/posts/${reportPostId}/report`, { method: 'POST', cookie: normal.cookie, body: { reason: '垃圾广告', note: '测试举报' } });
check('登录用户举报成功', userReport.status === 201, `HTTP ${userReport.status}`);
const dupReport = await req(`/api/posts/${reportPostId}/report`, { method: 'POST', cookie: normal.cookie, body: { reason: '垃圾广告' } });
check('重复举报被去重（429）', dupReport.status === 429, `HTTP ${dupReport.status}`);

const reports = await req('/api/admin/reports?status=pending&page=1', { cookie: admin.cookie });
const mine = reports.data.items.find((r) => r.post_id === reportPostId);
check('后台能看到举报记录', Boolean(mine), `待处理 ${reports.data?.items?.length ?? 0} 条`);
check('举报记录含被举报内容与作者', Boolean(mine?.post?.content && mine?.post?.author?.name), mine?.post?.author?.name || '');
check('举报记录含举报人与原因', mine?.reporter_name === '普通用户' && mine?.reason === '垃圾广告', `${mine?.reporter_name} / ${mine?.reason}`);

const proc = await req(`/api/admin/reports/${mine.id}/handle`, { method: 'POST', cookie: admin.cookie, body: { action: 'processing' } });
check('标记为处理中', proc.status === 200 && proc.data.report.status === 'processing', proc.data?.report?.status);

const delViolation = await req(`/api/admin/reports/${mine.id}/handle`, { method: 'POST', cookie: admin.cookie, body: { action: 'delete-post' } });
check('确认违规并删除内容', delViolation.status === 200 && delViolation.data.report.status === 'resolved', delViolation.data?.report?.status);

const postGone = await req('/api/posts?sort=latest&page=1');
check('被举报内容已从前台移除', !(postGone.data?.items || []).some((p) => p.id === reportPostId));

const resolvedList = await req('/api/admin/reports?status=resolved&page=1', { cookie: admin.cookie });
check('处理状态已持久化', resolvedList.data.items.some((r) => r.id === mine.id && r.status === 'resolved'));

const normalHandle = await req(`/api/admin/reports/${mine.id}/handle`, { method: 'POST', cookie: normal.cookie, body: { action: 'reject' } });
check('普通用户无法修改举报状态', normalHandle.status === 403, `HTTP ${normalHandle.status}`);

/* ---------- 8. 上传 ---------- */
const before = fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR).length : 0;
const up = await req('/api/admin/upload', { method: 'POST', cookie: admin.cookie, body: { image: PNG } });
check('管理员上传图片成功', up.status === 200 && up.data.url?.startsWith('/uploads/'), `HTTP ${up.status} ${up.data?.url || ''}`);
const badUpload = await req('/api/admin/upload', { method: 'POST', cookie: admin.cookie, body: { image: 'data:text/plain;base64,aGVsbG8=' } });
check('非图片类型被拒绝', badUpload.status === 400, `HTTP ${badUpload.status}`);

/* ---------- 9. 退出后失效 ---------- */
await req('/api/auth/logout', { method: 'POST', cookie: admin.cookie });
const afterLogout = await req('/api/admin/overview', { cookie: admin.cookie });
check('管理员退出后接口失效', afterLogout.status === 401, `HTTP ${afterLogout.status}`);

/* ---------- 清理 ---------- */
const cleanup = async () => {
  // 通过管理接口软删测试帖（若还在），并清理上传文件
  const list = await req(`/api/admin/posts?q=${encodeURIComponent('后台测试帖')}`, { cookie: admin.cookie });
  if (list.status === 200) {
    for (const p of list.data.items) {
      await req(`/api/admin/posts/${p.id}`, { method: 'DELETE', cookie: admin.cookie, body: { reason: '测试清理' } });
    }
  }
  try {
    for (const f of fs.readdirSync(UPLOAD_DIR)) {
      const full = path.join(UPLOAD_DIR, f);
      if (fs.statSync(full).size <= 200) fs.unlinkSync(full); // 测试用 1x1 png
    }
  } catch { /* noop */ }
};
await cleanup();

const passed = results.filter((r) => r.pass).length;
console.log(`\nTOTAL ${passed}/${results.length}`);
console.log(`ADMIN_EMAIL=${ADMIN_EMAIL}`);
if (passed !== results.length) process.exitCode = 1;
