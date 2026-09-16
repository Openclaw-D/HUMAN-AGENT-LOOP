#!/bin/bash
# D路轮询 v4：等 R1 触发信号（site 源码自首轮验收基线漂移 = A 开始修复；或 A 的 RESULT/STATUS 落地）
QA="C:/Users/22673/Desktop/Anthropic/V6/REPAIR_20260914_EVENING/qa"
PKG="$(dirname "$QA")"
SITE="C:/Users/22673/Desktop/Anthropic/jianwei-v3/site"
# 首轮验收时基线 hashset
BASE="96c4e5d52e053fe1"
for i in $(seq 1 120); do
  H=$(cd "$SITE" && { sha256sum app/v5-preview/page.tsx app/v5-preview/remote-session/page.tsx lib/v5-preview/shared-facts.ts lib/v5-preview/demo-story-service.ts app/v5-preview/remote-session/RemoteInterviewStagePage.tsx 2>/dev/null | sha256sum | cut -c1-16; })
  R=$(ls "$PKG/main/RESULT.md" "$PKG/main/STATUS.md" 2>/dev/null | head -2)
  TS=$(date '+%H:%M:%S')
  echo "[$TS] r1poll hashset=$H docs=${R:-none}" >> "$QA/logs/poll4-20260915.log"
  if [ "$H" != "$BASE" ]; then
    echo "[poll4] 源码漂移（A 修复开始）——退出" >> "$QA/logs/poll4-20260915.log"
    exit 0
  fi
  # A 的 STATUS/RESULT 落地后，若其中声明与 D 验收版本冲突也需知道（不退出，仅记录）
  sleep 240
done
echo "[poll4] 8h 超时" >> "$QA/logs/poll4-20260915.log"
exit 1
