#!/usr/bin/env bash
# 一键更新部署到阿里云 ECS
# 用法: bash scripts/deploy.sh
# 依赖: 本机 ~/.ssh/food_soul_deploy 私钥（已加入服务器 authorized_keys）
set -euo pipefail

HOST="${DEPLOY_HOST:-39.106.251.146}"
USER="${DEPLOY_USER:-root}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/food_soul_deploy}"
APP="${DEPLOY_APP:-/opt/food-soul}"

cd "$(dirname "$0")/.."

if [ ! -f "$KEY" ]; then
  echo "缺少私钥: $KEY" >&2
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
  src server public index.html package.json package-lock.json vite.config.js .env.example

echo "==> 上传到 $HOST"
scp -q -i "$KEY" -P 22 "$(cygpath -w "$TAR")" "$USER@$HOST:/tmp/food-soul-update.tar.gz"

echo "==> 服务器端解包 / 安装 / 构建 / 重启"
ssh -i "$KEY" "$USER@$HOST" "
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
