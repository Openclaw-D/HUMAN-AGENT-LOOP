#!/bin/bash
# V6 R1 触发监测（修正基线：启动时实时公式）
SITE="C:/Users/22673/Desktop/Anthropic/jianwei-v3/site"
LOG="C:/Users/22673/Desktop/Anthropic/V6/REPAIR_20260914_EVENING/qa/logs/watch-v6r1.log"
BASE=$(sha256sum "$SITE/app/v5-preview/page.tsx" "$SITE/app/v5-preview/remote-session/page.tsx" "$SITE/app/v5-preview/demo-story-panel.tsx" "$SITE/app/v5-preview/se-overview.module.css" "$SITE/app/v5-preview/api-client.ts" "$SITE/app/v5-preview/domain-row.tsx" "$SITE/app/v5-preview/rows-view.tsx" "$SITE"/lib/v5-preview/*.ts "$SITE"/app/api/v5-preview/demo/*/route.ts 2>/dev/null | sha256sum | cut -c1-16)
for i in $(seq 1 240); do
  H=$(sha256sum "$SITE/app/v5-preview/page.tsx" "$SITE/app/v5-preview/remote-session/page.tsx" "$SITE/app/v5-preview/demo-story-panel.tsx" "$SITE/app/v5-preview/se-overview.module.css" "$SITE/app/v5-preview/api-client.ts" "$SITE/app/v5-preview/domain-row.tsx" "$SITE/app/v5-preview/rows-view.tsx" "$SITE"/lib/v5-preview/*.ts "$SITE"/app/api/v5-preview/demo/*/route.ts 2>/dev/null | sha256sum | cut -c1-16)
  TS=$(date '+%m-%d %H:%M:%S')
  echo "[$TS] v6r1 hash=$H base=$BASE" >> "$LOG"
  if [ "$H" != "$BASE" ]; then echo "[v6r1] A 开始 R1 修复——退出" >> "$LOG"; exit 0; fi
  sleep 300
done
echo "[v6r1] 20h 超时" >> "$LOG"
exit 1
