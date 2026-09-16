#!/bin/bash
# D路轮询：等 A 发布可测信号（源码漂移 或 main/ 出现 BASELINE_GATE/INTERFACE/RESULT）
# 每 150s 检查一次；发现信号即退出 0；最长 ~4h 后超时退出 1。日志追加到 qa/logs/poll-20260914.log
QA="C:/Users/22673/Desktop/Anthropic/V6/REPAIR_20260914_EVENING/qa"
PKG="$(dirname "$QA")"
for i in $(seq 1 96); do
  {
    echo "=== poll $(date '+%m-%d %H:%M:%S') ==="
    node "$QA/runtime/check_publish.mjs" 2>&1
  } >> "$QA/logs/poll-20260914.log"
  DRIFT=$(grep -c "漂移\|已变" <(tail -8 "$QA/logs/poll-20260914.log") || true)
  MAIN=$(ls "$PKG/main" 2>/dev/null | head -3)
  if [ -n "$MAIN" ]; then echo "[poll] main/ 出现: $MAIN —— 退出等待" >> "$QA/logs/poll-20260914.log"; exit 0; fi
  if [ "$DRIFT" -gt 0 ]; then echo "[poll] 源码/3467 漂移信号 —— 退出等待" >> "$QA/logs/poll-20260914.log"; exit 0; fi
  sleep 150
done
echo "[poll] 4h 超时未见发布信号" >> "$QA/logs/poll-20260914.log"
exit 1
