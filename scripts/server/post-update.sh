#!/usr/bin/env bash
# ============================================================
# 服务器端部署钩子
# 安装位置：/opt/food-soul/.git/hooks/post-update
# 安装方式：node scripts/ship.mjs --install-hook（或 ssh 后 bash 执行）
# 触发时机：本地 `git push deploy main` 更新 /opt/food-soul 之后
# 职责：先同步 GitHub → 按需装依赖 → 构建 → 重启 pm2 → 健康检查 → 写状态
# ============================================================
set -uo pipefail

APP="${DEPLOY_APP:-/opt/food-soul}"
DEPLOY_DIR="$APP/.deploy"
LOG="$DEPLOY_DIR/deploy.log"
STATE="$DEPLOY_DIR/last.json"
LOCK="$DEPLOY_DIR/deploy.lock"

mkdir -p "$DEPLOY_DIR"
cd "$APP" || exit 1

# 输出同时回显给 push 端、并落到 deploy.log
exec > >(tee -a "$LOG") 2>&1

echo ""
echo "[deploy] $(date '+%F %T') 收到推送"

if [ -d "$LOCK" ]; then
  echo "[deploy] 上一次部署仍在进行，本次跳过"
  exit 0
fi
mkdir "$LOCK"
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

GIT="git --git-dir=$APP/.git --work-tree=$APP"
COMMIT=$($GIT rev-parse --short HEAD 2>/dev/null || echo "unknown")
SUBJECT=$($GIT log -1 --pretty=%s 2>/dev/null | sed 's/"/\\"/g')

github_ok=false
github_msg="未尝试"
build_ok=false
restart_ok=false
health_code="000"

# ---------- 1) 同步 GitHub（源仓库保持与线上一致） ----------
echo "[deploy] 同步 GitHub ..."
if GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=15" \
   timeout 180 $GIT push origin main >"$DEPLOY_DIR/github.log" 2>&1; then
  github_ok=true; github_msg="已同步"
else
  if grep -q "Permission denied\|could not read\|Authentication failed" "$DEPLOY_DIR/github.log" 2>/dev/null; then
    github_msg="鉴权失败：部署密钥未添加或无写权限（见 docs/DEPLOY.md）"
  else
    github_msg="同步失败（见 .deploy/github.log）"
  fi
fi
echo "[deploy] GitHub：$github_msg"

# ---------- 2) 依赖：仅在 package-lock.json 变化或 node_modules 缺失时安装 ----------
LOCK_HASH_FILE="$DEPLOY_DIR/package-lock.sha256"
NEW_LOCK_HASH=$(sha256sum package-lock.json 2>/dev/null | cut -d' ' -f1)
OLD_LOCK_HASH=$(cat "$LOCK_HASH_FILE" 2>/dev/null || echo "")
if [ ! -d node_modules ] || [ "$NEW_LOCK_HASH" != "$OLD_LOCK_HASH" ]; then
  echo "[deploy] 依赖有变化，执行 npm ci ..."
  if npm ci --no-audit --no-fund >"$DEPLOY_DIR/npm.log" 2>&1; then
    echo "$NEW_LOCK_HASH" > "$LOCK_HASH_FILE"
    echo "[deploy] 依赖安装完成"
  else
    echo "[deploy] npm ci 失败："
    tail -n 15 "$DEPLOY_DIR/npm.log"
  fi
fi

# ---------- 3) 构建 ----------
echo "[deploy] 构建中 ..."
if npm run build >"$DEPLOY_DIR/build.log" 2>&1; then
  build_ok=true
  echo "[deploy] 构建完成"
else
  echo "[deploy] 构建失败："
  tail -n 25 "$DEPLOY_DIR/build.log"
fi

# ---------- 4) 重启 ----------
if pm2 restart food-soul --update-env >/dev/null 2>&1; then
  restart_ok=true
fi
sleep 2
health_code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' http://127.0.0.1:5190/api/health 2>/dev/null || echo "000")

# ---------- 5) 写入部署状态（本地 ship.mjs 读取） ----------
{
  printf '{\n'
  printf '  "commit": "%s",\n' "$COMMIT"
  printf '  "subject": "%s",\n' "$SUBJECT"
  printf '  "time": "%s",\n' "$(date -Is)"
  printf '  "build_ok": %s,\n' "$build_ok"
  printf '  "restart_ok": %s,\n' "$restart_ok"
  printf '  "health": "%s",\n' "$health_code"
  printf '  "github_ok": %s,\n' "$github_ok"
  printf '  "github_msg": "%s"\n' "$github_msg"
  printf '}\n'
} > "$STATE"

echo "[deploy] 版本 $COMMIT ｜ 构建 $build_ok ｜ 健康检查 $health_code ｜ GitHub $github_msg"
if [ "$build_ok" = "true" ] && [ "$health_code" = "200" ]; then
  echo "[deploy] 完成 ✓"
else
  echo "[deploy] 存在异常，详见 $LOG"
fi