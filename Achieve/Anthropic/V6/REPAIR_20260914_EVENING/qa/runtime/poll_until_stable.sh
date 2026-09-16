#!/bin/bash
# D路轮询 v3：等 A 写入稳定（连续2次hash集不变）且出现部署/可测信号（3467指纹变化 或 main/RESULT.md）
QA="C:/Users/22673/Desktop/Anthropic/V6/REPAIR_20260914_EVENING/qa"
PKG="$(dirname "$QA")"
SITE="C:/Users/22673/Desktop/Anthropic/jianwei-v3/site"
PREV=""
STABLE=0
for i in $(seq 1 120); do
  H=$(cd "$SITE" && { sha256sum app/v5-preview/page.tsx app/v5-preview/remote-session/page.tsx app/v5-preview/demo-story-panel.tsx app/v5-preview/se-overview.module.css app/v5-preview/api-client.ts app/v5-preview/domain-row.tsx app/v5-preview/rows-view.tsx lib/v5-preview/*.ts app/api/v5-preview/demo/*/route.ts 2>/dev/null | sha256sum | cut -c1-16; })
  FP=$(curl -s --max-time 8 "http://127.0.0.1:3467/v5-preview" | sed 's/self\.__next_r="[^"]*"//' | sha256sum | cut -c1-16)
  R=$(ls "$PKG/main/RESULT.md" 2>/dev/null)
  TS=$(date '+%H:%M:%S')
  echo "[$TS] hashset=$H fp=$FP result=${R:-none}" >> "$QA/logs/poll3-20260914.log"
  if [ "$H" == "$PREV" ]; then STABLE=$((STABLE+1)); else STABLE=0; fi
  PREV="$H"
  if [ $STABLE -ge 2 ] && { [ -n "$R" ] || [ "$FP" != "f6b4c707f872c320" ]; }; then
    echo "[poll3] 写入稳定+信号具备（RESULT或3467部署）——退出" >> "$QA/logs/poll3-20260914.log"
    exit 0
  fi
  sleep 180
done
echo "[poll3] 6h 超时" >> "$QA/logs/poll3-20260914.log"
exit 1
