#!/usr/bin/env bash
# 兼容旧用法：实现已迁移到 scripts/ship.mjs（逻辑见 docs/DEPLOY.md）
#   bash scripts/deploy.sh            → 发布当前 HEAD
#   bash scripts/deploy.sh -m "msg"   → 提交并发布
# 需要 Node.js（项目本身已依赖）。
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/ship.mjs "$@"