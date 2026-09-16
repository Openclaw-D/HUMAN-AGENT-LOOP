#!/bin/bash
# D路轮询 v2：等 A 的「可测」声明或源码漂移（v1 在 main/ 出现时即退出，已消费）
# 每 150s 一次；命中即退出 0；约 4h 超时退出 1。日志: qa/logs/poll-20260914.log
QA="C:/Users/22673/Desktop/Anthropic/V6/REPAIR_20260914_EVENING/qa"
PKG="$(dirname "$QA")"
SITE="C:/Users/22673/Desktop/Anthropic/jianwei-v3/site"
for i in $(seq 1 96); do
  {
    echo "=== poll2 $(date '+%m-%d %H:%M:%S') ==="
    node "$QA/runtime/check_publish.mjs" 2>&1
  } >> "$QA/logs/poll-20260914.log"
  # 信号1：源码漂移（A 开始写 site）
  DRIFT=$(tail -8 "$QA/logs/poll-20260914.log" | grep -c "漂移" || true)
  # 信号2：main/STATUS 或 main/RESULT 含 可测/发布/可复测
  SIG=""
  for f in "$PKG/main/STATUS.md" "$PKG/main/RESULT.md"; do
    if [ -f "$f" ] && grep -qE "可测|发布|可复测" "$f" 2>/dev/null; then SIG="$f"; fi
  done
  if [ "$DRIFT" -gt 0 ] || [ -n "$SIG" ]; then
    echo "[poll2] 信号: DRIFT=$DRIFT SIG=$SIG —— 退出等待" >> "$QA/logs/poll-20260914.log"
    exit 0
  fi
  sleep 150
done
echo "[poll2] 4h 超时未见信号" >> "$QA/logs/poll-20260914.log"
exit 1
