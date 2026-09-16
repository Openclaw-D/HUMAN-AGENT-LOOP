#!/bin/bash
# MAIN专用：源码→预览副本白名单同步（app/v5-preview + lib/v5-preview + next.config除外）
SRC=/c/Users/22673/Desktop/Anthropic/jianwei-v3/site
DST=/c/Users/22673/Desktop/Anthropic/jianwei-v3/se-preview-20260913
cp -u $SRC/app/v5-preview/*.tsx $SRC/app/v5-preview/*.ts $SRC/app/v5-preview/*.css $DST/app/v5-preview/ 2>/dev/null
mkdir -p $DST/app/v5-preview/remote-session
cp -u $SRC/app/v5-preview/remote-session/*.tsx $SRC/app/v5-preview/remote-session/*.css $DST/app/v5-preview/remote-session/ 2>/dev/null
cp -u $SRC/lib/v5-preview/*.ts $DST/lib/v5-preview/ 2>/dev/null
# 不复制 next.config.ts（预览副本有turbopack.root专属配置）
echo "synced at $(date '+%H:%M:%S')"
