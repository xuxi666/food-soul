import { defineConfig } from 'vite';
import { handleApi } from './server/api.mjs';

function apiPlugin() {
  const mount = (server) => {
    server.middlewares.use((req, res, next) => {
      if (req.url && req.url.startsWith('/api/')) {
        handleApi(req, res);
        return;
      }
      next();
    });
  };
  return {
    name: 'food-soul-api',
    configureServer: mount,
    configurePreviewServer: mount,
  };
}

export default defineConfig({
  plugins: [apiPlugin()],
  server: {
    // 监听所有网卡，局域网内手机可直接访问
    host: '0.0.0.0',
    port: 5180,
    strictPort: true,
    // 允许通过局域网 IP / 主机名访问
    allowedHosts: true,
    // 编辑器原子写入会在 src 下产生 .xxx.tmpdir 临时目录，避免 watcher 锁死崩溃
    watch: {
      ignored: ['**/.*tmpdir*', '**/*.tmp', '**/node_modules/**', '**/.git/**'],
    },
  },
  build: {
    target: 'es2020',
  },
});
