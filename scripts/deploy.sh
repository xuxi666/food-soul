#!/usr/bin/env bash
# 一键更新部署（默认按 PM2 + Nginx 的单机部署）
# 用法:
#   cp .deploy.env.example .deploy.env   # 填入自己的服务器信息（该文件已被 git 忽略）
#   bash scripts/deploy.sh
# 也可直接用环境变量: DEPLOY_HOST=1.2.3.4 DEPLOY_USER=root bash scripts/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

# 本地部署配置（不入库）
if [ -f .deploy.env ]; then
  # shellcheck disable=SC1091
  . ./.deploy.env
fi

HOST="${DEPLOY_HOST:-}"
USER="${DEPLOY_USER:-root}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/id_ed25519}"
APP="${DEPLOY_APP:-/opt/food-soul}"
PORT="${DEPLOY_PORT:-22}"

if [ -z "$HOST" ]; then
  echo "未配置服务器地址。请创建 .deploy.env（参考 .deploy.env.example）或设置 DEPLOY_HOST 环境变量。" >&2
  exit 1
fi

if [ ! -f "$KEY" ]; then
  echo "缺少私钥: $KEY（可用 DEPLOY_KEY 指定）" >&2
  exit 1
fi

# Git Bash 会把 /opt/... 之类的参数改写成 Windows 路径，这里统一禁用
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

TAR="$(cygpath -u "$(mktemp -t food-soul-XXXXXX.tar.gz)")"
trap 'rm -f "$TAR"' EXIT

echo "==> 打包源码（不含 node_modules / dist / data / .env）"
tar -czf "$TAR" \
  --exclude='public/uploads' \
  src server scripts public index.html package.json package-lock.json vite.config.js .env.example

echo "==> 上传到 $HOST"
scp -q -i "$KEY" -P "$PORT" "$(cygpath -w "$TAR")" "$USER@$HOST:/tmp/food-soul-update.tar.gz"

echo "==> 服务器端解包 / 安装 / 构建 / 重启"
ssh -p "$PORT" -i "$KEY" "$USER@$HOST" "
  set -e
  cd $APP
  tar -xzf /tmp/food-soul-update.tar.gz
  rm -f /tmp/food-soul-update.tar.gz
  npm ci --no-audit --no-fund >/dev/null 2>&1
  npm run build 2>&1 | tail -6
  pm2 restart food-soul --update-env >/dev/null
  sleep 2
  pm2 list | grep food-soul
  curl -s -o /dev/null -w 'local health: %{http_code}\n' http://127.0.0.1:5190/api/health
"

echo "==> 完成。访问: http://$HOST/"
