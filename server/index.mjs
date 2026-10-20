// 生产模式：静态托管 dist + /api（无需 express）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from './api.mjs';
import { SERVER_CONFIG } from './config.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const publicDir = path.join(root, 'public');
const port = SERVER_CONFIG.port;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
};

/**
 * 静态资源处理。
 * 注意：decodeURIComponent 遇到畸形百分号编码会抛 URIError，
 * 之前未捕获会直接杀掉进程（表现为整站 502），这里改为 400。
 */
function handleStatic(req, res) {
  if (req.url.startsWith('/api/')) return handleApi(req, res);

  let decoded;
  try {
    decoded = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('Bad Request');
  }

  // 用户上传图片：生产环境也要能访问（dist 不包含 uploads）
  if (decoded.startsWith('/uploads/')) {
    const up = path.resolve(publicDir, '.' + decoded);
    if (up !== publicDir && !up.startsWith(publicDir + path.sep)) {
      res.statusCode = 403;
      return res.end('Forbidden');
    }
    if (fs.existsSync(up) && fs.statSync(up).isFile()) {
      res.setHeader('Content-Type', MIME[path.extname(up)] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return fs.createReadStream(up).pipe(res);
    }
    res.statusCode = 404;
    return res.end('Not found');
  }

  // 静态资源：路径必须落在 dist 内，防目录穿越
  const filePath = path.resolve(dist, '.' + decoded);
  if (filePath !== dist && !filePath.startsWith(dist + path.sep)) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }

  // SPA 路由回退
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    const fallback = path.join(dist, 'index.html');
    if (fs.existsSync(fallback)) {
      res.setHeader('Content-Type', MIME['.html']);
      res.setHeader('Cache-Control', 'no-store');
      return fs.createReadStream(fallback).pipe(res);
    }
    res.statusCode = 404;
    return res.end('Not found. Run `npm run build` first.');
  }
  res.setHeader('Content-Type', MIME[path.extname(filePath)] || 'application/octet-stream');
  res.setHeader('Cache-Control', path.extname(filePath) === '.html' ? 'no-store' : 'public, max-age=31536000, immutable');
  fs.createReadStream(filePath).pipe(res);
}

// 任何未捕获异常都不允许打挂进程：回 500 并记录，Nginx 不会因此变成 502
const server = http.createServer((req, res) => {
  const fail = (err) => {
    console.error('[server] %s %s -> 500 | %s', req.method, req.url, String(err?.stack || err).split('\n')[0]);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Internal Server Error');
    } else {
      try { res.end(); } catch { /* noop */ }
    }
  };
  try {
    const out = handleStatic(req, res);
    if (out && typeof out.catch === 'function') out.catch(fail);
  } catch (err) {
    fail(err);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`食有灵 · FOOD SOUL → http://127.0.0.1:${port}`);
  console.log('AI: 用户级配置（每个账号使用自己的 Base URL / 模型 / API Key）');
  console.log('DB: data/foodsoul.db（用户、会话、加密后的 AI 配置）');
});
