// 社区发布鉴权验收：未登录/已登录/退出/伪造身份/越权
// 用法: node scripts/verify-community-auth.mjs
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:5180';
const UPLOAD_DIR = path.resolve('public/uploads');

const results = [];
const check = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}${extra ? ' | ' + extra : ''}`);
};

let cookie = '';

async function req(pathname, { method = 'GET', body, cookie: c = cookie, headers = {} } = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: BASE,
      ...(c ? { Cookie: c } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.getSetCookie?.() || [];
  const sess = sc.find((x) => x.startsWith('fs_session='));
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data, setCookie: sess ? sess.split(';')[0] : null };
}

function uploadCount() {
  try { return fs.readdirSync(UPLOAD_DIR).length; } catch { return 0; }
}

// 1x1 png
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const stamp = Date.now();
const emailA = `comm-a-${stamp}@example.com`;
const emailB = `comm-b-${stamp}@example.com`;
const PASS = 'CommTest1234!';

/* ---------- 未登录 ---------- */
const list = await req('/api/posts?sort=latest&page=1');
check('未登录可浏览帖子列表', list.status === 200 && Array.isArray(list.data?.items), `HTTP ${list.status} 共 ${list.data?.items?.length ?? 0} 条`);

const before = uploadCount();
const anonPost = await req('/api/posts', { method: 'POST', body: { content: '未登录不该发出去' } });
check('未登录发帖返回 401', anonPost.status === 401, `HTTP ${anonPost.status} ${anonPost.data?.error || ''}`);

const anonUpload = await req('/api/upload', { method: 'POST', body: { image: PNG } });
check('未登录上传返回 401', anonUpload.status === 401, `HTTP ${anonUpload.status}`);
check('未授权上传未落盘', uploadCount() === before, `上传目录 ${before} -> ${uploadCount()}`);

const anonComment = await req(`/api/posts/${list.data?.items?.[0]?.id}/comments`, { method: 'POST', body: { content: '未登录评论' } });
check('未登录评论返回 401', anonComment.status === 401, `HTTP ${anonComment.status}`);

const anonDelete = await req(`/api/posts/${list.data?.items?.[0]?.id}`, { method: 'DELETE' });
check('未登录删除返回 401', anonDelete.status === 401, `HTTP ${anonDelete.status}`);

const anonPostWithFakeId = await req('/api/posts', {
  method: 'POST',
  body: { content: '伪造身份发帖', author: { id: 'fake-user', name: 'hacker' }, userId: 'fake-user' },
  headers: { 'x-guest-id': 'fake-user', 'x-guest-name': encodeURIComponent('hacker') },
});
check('未登录 + 伪造 userId 仍返回 401', anonPostWithFakeId.status === 401, `HTTP ${anonPostWithFakeId.status}`);

/* ---------- 注册并登录 A ---------- */
const regA = await req('/api/auth/register', { method: 'POST', body: { email: emailA, password: PASS, name: '社区A' } });
cookie = regA.setCookie || '';
check('注册并登录用户 A', Boolean(cookie), `HTTP ${regA.status}`);
const userAId = regA.data?.user?.id;

const postA = await req('/api/posts', {
  method: 'POST',
  body: { content: `A 的帖子 ${stamp}`, author: { id: 'someone-else', name: '冒充者' }, userId: 'someone-else' },
  headers: { 'x-guest-id': 'someone-else', 'x-guest-name': encodeURIComponent('冒充者') },
});
check('登录后发帖成功', postA.status === 201, `HTTP ${postA.status}`);
check('作者绑定当前登录用户（伪造无效）', postA.data?.post?.author?.id === userAId, `author=${postA.data?.post?.author?.id} 期望=${userAId}`);
const postAId = postA.data?.post?.id;

const upA = await req('/api/upload', { method: 'POST', body: { image: PNG } });
check('登录后上传图片成功', upA.status === 200 && Boolean(upA.data?.url), `HTTP ${upA.status} ${upA.data?.url || ''}`);

const cmtA = await req(`/api/posts/${postAId}/comments`, { method: 'POST', body: { content: 'A 的评论' } });
check('登录后评论成功', cmtA.status === 201, `HTTP ${cmtA.status}`);

const withImg = await req('/api/posts', { method: 'POST', body: { content: `带图帖子 ${stamp}`, images: [upA.data?.url] } });
check('登录后可发布带图帖子', withImg.status === 201 && (withImg.data?.post?.images?.length || 0) > 0, `HTTP ${withImg.status}`);

// 回归：大体积图片帖（曾因服务端 200KB 上限直接断连，Nginx 返回 502）
// 300KB 请求体：应被正常读取并返回业务校验错误（400），而不是断连成 502
const bigBody = await req('/api/posts', { method: 'POST', body: { content: 'x'.repeat(300 * 1024) } });
check('普通用户提交 300KB 请求体不再 502', bigBody.status === 400, `HTTP ${bigBody.status} ${bigBody.data?.error || ''}`);

// 超过上限应返回 413，而不是 502
const huge = 'data:image/jpeg;base64,' + Buffer.alloc(15 * 1024 * 1024).toString('base64');
const tooBig = await req('/api/posts', { method: 'POST', body: { content: '超大请求体', images: [huge] } });
check('超过体积上限返回 413 而非 502', tooBig.status === 413, `HTTP ${tooBig.status} ${tooBig.data?.error || ''}`);

// 服务仍存活（不是崩溃后重启）
const alive = await req('/api/health');
check('大请求后服务仍健康', alive.status === 200 && alive.data?.ok === true, `HTTP ${alive.status}`);

/* ---------- 用户 B 越权 ---------- */
const cookieA = cookie;
const regB = await req('/api/auth/register', { method: 'POST', body: { email: emailB, password: PASS, name: '社区B' } });
cookie = regB.setCookie || '';
check('注册并登录用户 B', Boolean(cookie));

const delByB = await req(`/api/posts/${postAId}`, { method: 'DELETE' });
check('B 无法删除 A 的帖子', delByB.status === 403, `HTTP ${delByB.status} ${delByB.data?.error || ''}`);

/* ---------- A 删除自己的帖子 ---------- */
cookie = cookieA;
const delByA = await req(`/api/posts/${postAId}`, { method: 'DELETE' });
check('A 可删除自己的帖子', delByA.status === 200, `HTTP ${delByA.status}`);

/* ---------- 退出登录 ---------- */
const out = await req('/api/auth/logout', { method: 'POST' });
check('退出登录成功', out.status === 200 || out.status === 204, `HTTP ${out.status}`);
const afterLogout = await req('/api/posts', { method: 'POST', body: { content: '退出后不该发出去' }, cookie: cookieA });
check('退出后发帖返回 401', afterLogout.status === 401, `HTTP ${afterLogout.status}`);

/* ---------- 失效/伪造会话 ---------- */
const forged = await req('/api/posts', { method: 'POST', body: { content: '伪造 cookie' }, cookie: 'fs_session=deadbeefdeadbeefdeadbeefdeadbeef' });
check('伪造会话 cookie 发帖返回 401', forged.status === 401, `HTTP ${forged.status}`);

/* ---------- 浏览不受影响 ---------- */
const listAfter = await req('/api/posts?sort=latest&page=1');
check('未登录浏览仍然正常', listAfter.status === 200 && Array.isArray(listAfter.data?.items), `共 ${listAfter.data?.items?.length} 条`);

const passed = results.filter((r) => r.pass).length;
console.log(`\nTOTAL ${passed}/${results.length}`);
if (passed !== results.length) process.exitCode = 1;
