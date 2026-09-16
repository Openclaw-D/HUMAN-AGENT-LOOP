#!/bin/bash
# V7 D路监测器：等 A 的 CONTRACT.md / assembly 产物 / B、C 的 STATUS+RESULT（每小时心跳节律友好：4分钟一查，发现即退）
V7="C:/Users/22673/Desktop/Anthropic/V7/backend"
LOG="$V7/D/runtime/watch.log"
for i in $(seq 1 240); do
  {
    SIG=""
    [ -f "$V7/CONTRACT.md" ] && SIG="$SIG CONTRACT"
    [ -d "$V7/A/assembly" ] && SIG="$SIG ASSEMBLY"
    for L in B C; do
      [ -f "$V7/$L/STATUS.md" ] && SIG="$SIG $L:STATUS"
      [ -f "$V7/$L/RESULT.md" ] && SIG="$SIG $L:RESULT"
    done
    TS=$(date '+%m-%d %H:%M:%S')
    echo "[$TS] sig=${SIG:-none}" >> "$LOG"
    if [ -n "$SIG" ]; then echo "[watch] 信号:$SIG —— 退出" >> "$LOG"; exit 0; fi
  } 2>/dev/null
  sleep 240
done
echo "[watch] 16h 超时" >> "$LOG"
exit 1
