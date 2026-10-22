#!/usr/bin/env bash
# 首次接管服务器：把 /opt/food-soul 从「解压目录」变成「GitHub 仓库的部署工作区」
# 由本地 `node scripts/ship.mjs --bootstrap` 上传执行；可重复执行（幂等）
set -euo pipefail

APP="${DEPLOY_APP:-/opt/food-soul}"
REPO_URL="${GITHUB_URL:-https://github.com/xuxi666/food-soul.git}"
BRANCH="${DEPLOY_BRANCH:-main}"

echo "[初始化] 应用目录 $APP"
[ -d "$APP" ] || { echo "目录不存在: $APP"; exit 1; }
cd "$APP"

if [ -d .git ] && git rev-parse --verify -q HEAD >/dev/null 2>&1; then
  echo "[初始化] 已是可用的 git 仓库，跳过 clone/reset"
else
  echo "[初始化] 拉取 GitHub 仓库 $REPO_URL"
  [ -d .git ] || git init -q -b "$BRANCH"
  git config core.autocrlf false
  git config user.name "food-soul server"
  git config user.email "server@food-soul.local"
  git remote remove origin 2>/dev/null || true
  git remote add origin "$REPO_URL"
  # 国内机房直连 GitHub 偶发 TLS 中断，最多重试 4 次
  for i in 1 2 3 4; do
    echo "[初始化] 拉取 GitHub（第 $i 次）"
    if git -c http.version=HTTP/1.1 fetch -q origin "$BRANCH"; then break; fi
    [ "$i" = "4" ] && { echo "[初始化] 拉取 GitHub 失败"; exit 1; }
    sleep 4
  done
  # 只覆盖仓库内被跟踪的文件；.env / data / node_modules / dist / public/uploads 均被忽略，原样保留
  git reset -q --hard FETCH_HEAD
fi

git config receive.denyCurrentBranch updateInstead
git config core.autocrlf false
mkdir -p .deploy
grep -qxF '.deploy/' .git/info/exclude 2>/dev/null || echo '.deploy/' >> .git/info/exclude

echo "[初始化] 仓库状态："
git --no-pager log --oneline -1
echo "[初始化] 未跟踪/已忽略（应保留）："
ls -d .env data node_modules dist public/uploads 2>/dev/null | sed 's/^/  - /'
echo "[初始化] 工作区差异（应为空）："
git status --porcelain | head -20
echo "[初始化] 完成"