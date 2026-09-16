#!/bin/bash
# D路隔离实例同步+启动（REPAIR_20260914_EVENING）
# 用途：A发布后，把 site 源同步到 qa/runtime/app（排除 node_modules/.next/.git），
#       建 junction 复用 site/node_modules，写 QA 专用 next.config（turbopack.root 提升），
#       然后以独立数据目录启动在 3469。产品 site 与共享预览 3467 零写入。
# 用法：bash sync_isolated.sh sync   # 仅同步
#       bash sync_isolated.sh start  # 同步+后台启动（日志到 qa/logs/isolated-3469.log）
set -e
SITE="C:/Users/22673/Desktop/Anthropic/jianwei-v3/site"
QA="C:/Users/22673/Desktop/Anthropic/V6/REPAIR_20260914_EVENING/qa"
APP="$QA/runtime/app"
DATA="$QA/runtime/data-d"
PORT=3469

sync_app() {
  mkdir -p "$APP" "$DATA"
  rsync -a --delete \
    --exclude node_modules --exclude .next --exclude .git \
    --exclude '*.log' \
    "$SITE/" "$APP/" 2>/dev/null || {
      # git-bash 无 rsync 时退化为 cp 关键目录
      rm -rf "$APP"
      mkdir -p "$APP"
      cp -r "$SITE/app" "$SITE/lib" "$SITE/public" "$APP/" 2>/dev/null || true
      cp "$SITE/package.json" "$SITE/tsconfig.json" "$SITE/next-env.d.ts" "$SITE/eslint.config.mjs" "$APP/" 2>/dev/null || true
      cp "$SITE/postcss.config.mjs" "$APP/" 2>/dev/null || true
    }
  # QA 专用 next.config（仅隔离副本；产品配置不动）——必须在 junction 之前写，set -e 中断也不会漏
  cat > "$APP/next.config.ts" <<'EOF'
import type { NextConfig } from 'next';

// D-QA 测试装置配置：仅本 QA 副本使用。turbopack.root 显式提升文件系统根，
// 使 node_modules junction（→ jianwei-v3/site/node_modules）位于根内。
// 验收以产品实际配置为准。
const nextConfig: NextConfig = {
  turbopack: {
    root: 'C:/Users/22673/Desktop/Anthropic',
  },
};

export default nextConfig;
EOF
  # node_modules junction（已存在则跳过；Node fs.symlinkSync 免管理员）
  if [ ! -e "$APP/node_modules" ]; then
    node -e "require('fs').symlinkSync(process.argv[1],process.argv[2],'junction')" \
      "$SITE/node_modules" "$APP/node_modules"
  fi
  echo "[sync] 完成：$APP"
}

start_app() {
  cd "$APP"
  V5_PREVIEW_DATA_DIR="$DATA" node node_modules/next/dist/bin/next dev -p $PORT \
    > "$QA/logs/isolated-$PORT.log" 2>&1 &
  echo $! > "$QA/runtime/isolated-$PORT.pid"
  echo "[start] PID=$! 端口=$PORT 数据目录=$DATA 日志=$QA/logs/isolated-$PORT.log"
  sleep 8
  curl -s -o /dev/null -w "[start] GET /v5-preview -> %{http_code}\n" "http://127.0.0.1:$PORT/v5-preview" || true
}

case "${1:-}" in
  sync) sync_app ;;
  start) sync_app && start_app ;;
  *) echo "用法: bash sync_isolated.sh sync|start"; exit 1 ;;
esac
