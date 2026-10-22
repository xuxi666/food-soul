#!/usr/bin/env bash
# 在服务器生成 GitHub 部署密钥（只读会打印公钥，私钥不出服务器）
# 由本地 `node scripts/ship.mjs --github-setup` 上传执行；可重复执行（幂等）
set -euo pipefail

APP="${DEPLOY_APP:-/opt/food-soul}"
KEY="$HOME/.ssh/github_food_soul"
SSH_CONFIG="$HOME/.ssh/config"

echo "[GitHub] 准备部署密钥"
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"

if [ -f "$KEY" ]; then
  echo "[GitHub] 密钥已存在，复用 $KEY"
else
  ssh-keygen -t ed25519 -N "" -C "food-soul deploy@$(hostname)" -f "$KEY" -q
  echo "[GitHub] 已生成 $KEY"
fi
chmod 600 "$KEY"

# 让 github.com 固定使用这把部署密钥
touch "$SSH_CONFIG"
chmod 600 "$SSH_CONFIG"
if ! grep -q "Host github.com" "$SSH_CONFIG" 2>/dev/null; then
  cat >> "$SSH_CONFIG" <<EOF

Host github.com
  HostName github.com
  User git
  IdentityFile $KEY
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
EOF
  echo "[GitHub] 已写入 ~/.ssh/config"
fi

# 仓库远端改成 SSH（若当前是 https）
cd "$APP"
URL=$(git config --get remote.origin.url || echo "")
case "$URL" in
  git@github.com:*) echo "[GitHub] 远端已是 SSH: $URL" ;;
  *)
    git remote set-url origin git@github.com:xuxi666/food-soul.git
    echo "[GitHub] 远端已切换为 SSH: git@github.com:xuxi666/food-soul.git"
    ;;
esac

# 预热 known_hosts，避免首次推送时因主机指纹中断
ssh-keyscan -T 10 github.com >> "$HOME/.ssh/known_hosts" 2>/dev/null || true

echo ""
echo "[GitHub] 把下面这行公钥添加到 GitHub："
echo "        仓库 → Settings → Deploy keys → Add deploy key"
echo "        勾选 Allow write access（必须勾选，否则无法推送）"
echo ""
echo "--------------------------------------------------------------"
cat "$KEY.pub"
echo "--------------------------------------------------------------"
echo ""
echo "[GitHub] 添加后可执行验证："
echo "        cd $APP && GIT_SSH_COMMAND='ssh -o BatchMode=yes' git ls-remote origin main"