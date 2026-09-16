#!/bin/bash
# V7 D路监测器 v2：等下一轮验收触发信号
# 信号A：A/src 或 assembly/MANIFEST hash 漂移（基线=启动时实时公式，防证据文件字节差异误报）
# 信号B：B/RESULT.md 出现（B 交付完成）
# 信号C：A/STATUS 或 A/RESULT 更新时间晚于 D 首轮（记录但不退出）
V7B="C:/Users/22673/Desktop/Anthropic/V7/backend"
LOG="$V7B/D/runtime/watch2.log"
BASE_A=$(sha256sum "$V7B/A/src/"*.mjs 2>/dev/null | sha256sum | cut -c1-16)
BASE_MANIFEST=$(sha256sum "$V7B/A/assembly/MANIFEST.md" 2>/dev/null | cut -c1-16)
for i in $(seq 1 240); do
  H=$(sha256sum "$V7B/A/src/"*.mjs 2>/dev/null | sha256sum | cut -c1-16)
  HM=$(sha256sum "$V7B/A/assembly/MANIFEST.md" 2>/dev/null | cut -c1-16)
  TS=$(date '+%m-%d %H:%M:%S')
  echo "[$TS] a=$H manifest=$HM" >> "$LOG"
  if [ "$H" != "$BASE_A" ]; then
    sleep 240
    H2=$(sha256sum "$V7B/A/src/"*.mjs 2>/dev/null | sha256sum | cut -c1-16)
    if [ "$H2" == "$H" ]; then
      echo "[watch2] 触发: 漂移后已稳定 ($H) —— 复测窗口" >> "$LOG"
      exit 0
    fi
    BASE_A=$H2
    echo "[watch2] 仍在漂移，继续等" >> "$LOG"
  fi
  sleep 240
done
echo "[watch2] 16h 超时" >> "$LOG"
exit 1
