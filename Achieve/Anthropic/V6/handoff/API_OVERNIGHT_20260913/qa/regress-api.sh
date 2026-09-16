#!/usr/bin/env bash
# D路（V6-API-QA）API级回归 · 少量高价值 · 只读+受控写（仅新建[D-QA]会话内）
# 用法：bash regress-api.sh [BASE_URL]   默认 http://127.0.0.1:3467
# 产物：逐项 PASS/FAIL 输出 + 摘要写入 regress-api-result.md（由调用方重定向）
# 边界：不重置库、不删任何既有数据、不并发压测；仅 title 带 [D-QA 合成] 前缀的会话。
set -u
BASE="${1:-http://127.0.0.1:3467}"
API="$BASE/api/v5-preview/remote-session"
TS=$(date +%m%d%H%M%S)
RID="dqa-$TS-$RANDOM"
PASS=0; FAIL=0
say() { echo "[$1] $2"; }
check() { # check <name> <python-expr on json text via stdin as 'd'>
  local name="$1" expr="$2" text; text=$(cat)
  if echo "$text" | python -c "
import sys, json
d = json.load(sys.stdin)
sys.exit(0 if ($expr) else 1)
" 2>/dev/null; then say PASS "$name"; PASS=$((PASS+1)); return 0
  else say FAIL "$name"; echo "$text" | head -c 600; echo; FAIL=$((FAIL+1)); return 1; fi
}
post() { local path="$1" body="$2"; curl -sS -X POST "$API/$path" -H 'Content-Type: application/json' -d "$body"; }
getv() { curl -sS "$API/$1" | python -c "import sys,json;print(json.load(sys.stdin)$2)"; }

say INFO "BASE=$BASE  RID前缀=$RID"

# 0) 服务可达
STATE=$(curl -sS "$API"); echo "$STATE" | check "T0 服务可达且返回remoteVersion" "d.get('ok') is True and isinstance(d.get('remoteVersion'), int)"

# 1) 建独立会话 [D-QA]
V=$(getv "" "['remoteVersion']")
R=$(post "" "{\"requestId\":\"$RID-create\",\"expectedVersion\":$V,\"title\":\"[D-QA 合成] D路回归会话 $TS\"}")
echo "$R" | check "T1 创建[D-QA]会话" "d.get('ok') is True and d['session']['title'].startswith('[D-QA 合成]')"
SID=$(echo "$R" | python -c "import sys,json;print(json.load(sys.stdin)['session']['sessionId'])")
say INFO "sessionId=$SID"

# 2) 附着合成证据
V=$(getv "detail?sessionId=$SID" "['remoteVersion']")
R=$(post "evidence" "{\"requestId\":\"$RID-ev\",\"expectedVersion\":$V,\"sessionId\":\"$SID\",\"fixtureId\":\"fixture-inspection\"}")
echo "$R" | check "T2 附着合成证据" "d.get('ok') is True and d['evidence']['fixtureId']=='fixture-inspection'"
EVID=$(echo "$R" | python -c "import sys,json;print(json.load(sys.stdin)['evidence']['evidenceId'])")

# 3) 创建标注（关键问题）
V=$(getv "detail?sessionId=$SID" "['remoteVersion']")
R=$(post "annotations" "{\"requestId\":\"$RID-an\",\"expectedVersion\":$V,\"sessionId\":\"$SID\",\"evidenceId\":\"$EVID\",\"evidenceVersion\":1,\"question\":\"D路回归问题：请说明设备现状（合成）\",\"rect\":{\"x\":0,\"y\":0,\"w\":1,\"h\":1}}")
echo "$R" | check "T3 创建标注" "d.get('ok') is True"
ANID=$(echo "$R" | python -c "import sys,json;print(json.load(sys.stdin)['annotation']['annotationId'])")

# 4) 人工补充/纠正（business回复）—— R3 前半
V=$(getv "detail?sessionId=$SID" "['remoteVersion']")
R=$(post "annotations/replies" "{\"requestId\":\"$RID-corr\",\"expectedVersion\":$V,\"sessionId\":\"$SID\",\"annotationId\":\"$ANID\",\"kind\":\"business\",\"text\":\"人工纠正：实际设备为5台，非口述3台（D路合成纠正）\"}")
echo "$R" | check "T4 人工纠正已追加" "d.get('ok') is True and sum(1 for r in d['annotation']['replies'] if r['kind']=='business')==1"
CORR_REPLY_N=$(echo "$R" | python -c "import sys,json;print(len(json.load(sys.stdin)['annotation']['replies']))")

# 5) 模拟分析（现有模拟入口）—— R1模拟侧 + 版本依据
V=$(getv "detail?sessionId=$SID" "['remoteVersion']")
R=$(post "annotations/simulate" "{\"requestId\":\"$RID-sim\",\"expectedVersion\":$V,\"sessionId\":\"$SID\",\"annotationId\":\"$ANID\"}")
echo "$R" | check "T5 模拟分析成功且回复标model_simulation" "d.get('ok') is True and d.get('simulated') is True and all(r['kind']=='model_simulation' for r in d['annotation']['replies'] if r['replyId'] not in [rr['replyId'] for rr in d['annotation']['replies'] if rr['kind']=='business'])"
SIM_REPLY_N=$(echo "$R" | python -c "import sys,json;print(len(json.load(sys.stdin)['annotation']['replies']))")

# 6) 同requestId重放（R5 幂等不重复追加）
R2=$(post "annotations/simulate" "{\"requestId\":\"$RID-sim\",\"expectedVersion\":$V,\"sessionId\":\"$SID\",\"annotationId\":\"$ANID\"}")
N2=$(echo "$R2" | python -c "import sys,json;print(len(json.load(sys.stdin)['annotation']['replies']))" 2>/dev/null || echo "ERR")
if [ "$N2" = "$SIM_REPLY_N" ]; then say PASS "T6 同requestId重放不重复追加（replies=$N2）"; PASS=$((PASS+1)); else say FAIL "T6 重放后replies数变化：$SIM_REPLY_N -> $N2"; FAIL=$((FAIL+1)); fi

# 7) 刷新读回（R4）：GET detail 校验纠正+模拟回复都在
D=$(curl -sS "$API/detail?sessionId=$SID")
echo "$D" > /tmp/dqa-detail.json
echo "$D" | python -c "
import sys, json
d = json.load(sys.stdin)
an = [a for a in d['annotations'] if a['annotationId']=='$ANID'][0]
kinds = [r['kind'] for r in an['replies']]
texts = [r['text'] for r in an['replies']]
ok_corr = any('人工纠正：实际设备为5台' in t for t in texts)
ok_sim = kinds.count('model_simulation') >= 1 and kinds.count('business') >= 1
sys.exit(0 if (ok_corr and ok_sim and len(an['replies'])==$SIM_REPLY_N) else 1)
" && { say PASS "T7 刷新读回：纠正+模拟回复均在且数量一致"; PASS=$((PASS+1)); } || { say FAIL "T7 刷新读回不一致"; FAIL=$((FAIL+1)); }

# 8) 暂停后模型推进被阻断（R6a）
V=$(getv "detail?sessionId=$SID" "['remoteVersion']")
R=$(post "reviews" "{\"requestId\":\"$RID-pause\",\"expectedVersion\":$V,\"sessionId\":\"$SID\",\"targetType\":\"annotation\",\"targetId\":\"$ANID\",\"targetVersion\":$(echo "$D" | python -c "import sys,json;d=json.load(sys.stdin);print([a for a in d['annotations'] if a['annotationId']=='$ANID'][0]['version'])"),\"action\":\"pause_round\",\"opinion\":\"D路暂停门回归（合成）\"}")
echo "$R" | check "T8 暂停成功" "d.get('ok') is True and d.get('sessionStatus')=='paused'"
CODE=$(curl -sS -o /tmp/dqa-paused.json -w '%{http_code}' -X POST "$API/annotations/simulate" -H 'Content-Type: application/json' -d "{\"requestId\":\"$RID-simpaused\",\"expectedVersion\":$(getv "detail?sessionId=$SID" "['remoteVersion']"),\"sessionId\":\"$SID\",\"annotationId\":\"$ANID\"}")
if [ "$CODE" = "409" ]; then say PASS "T8b 暂停中simulate返回409（SESSION_PAUSED）"; PASS=$((PASS+1)); else say FAIL "T8b 暂停中simulate返回$CODE（预期409）"; FAIL=$((FAIL+1)); fi

# 9) 恢复 + 证据重拍取代 → 旧标注/证据过期标识（R6b）
V=$(getv "detail?sessionId=$SID" "['remoteVersion']")
R=$(post "reviews" "{\"requestId\":\"$RID-resume\",\"expectedVersion\":$V,\"sessionId\":\"$SID\",\"targetType\":\"annotation\",\"targetId\":\"$ANID\",\"targetVersion\":99,\"action\":\"resume_round\",\"opinion\":\"D路恢复（合成）\"}")
# targetVersion 故意错：resume 对标注版本不敏感？——按服务实现复核版本门；如409则重取后再发
if ! echo "$R" | python -c "import sys,json;sys.exit(0 if json.load(sys.stdin).get('ok') else 1)" 2>/dev/null; then
  V=$(getv "detail?sessionId=$SID" "['remoteVersion']")
  ANV=$(getv "detail?sessionId=$SID" "['annotations'][0]['version']")
  R=$(post "reviews" "{\"requestId\":\"$RID-resume2\",\"expectedVersion\":$V,\"sessionId\":\"$SID\",\"targetType\":\"annotation\",\"targetId\":\"$ANID\",\"targetVersion\":$ANV,\"action\":\"resume_round\",\"opinion\":\"D路恢复（合成）\"}")
fi
echo "$R" | check "T9 恢复成功" "d.get('ok') is True and d.get('sessionStatus')=='live'"
V=$(getv "detail?sessionId=$SID" "['remoteVersion']")
R=$(post "evidence/supersede" "{\"requestId\":\"$RID-sup\",\"expectedVersion\":$V,\"sessionId\":\"$SID\",\"evidenceId\":\"$EVID\",\"fixtureId\":\"fixture-inspection\"}")
echo "$R" | check "T9b 证据被新版本取代" "d.get('ok') is True and d['evidence']['supersedes']=='$EVID'"
D=$(curl -sS "$API/detail?sessionId=$SID")
echo "$D" | python -c "
import sys, json
d = json.load(sys.stdin)
ev = [e for e in d['evidence'] if e['evidenceId']=='$EVID'][0]
an = [a for a in d['annotations'] if a['annotationId']=='$ANID'][0]
sys.exit(0 if (ev['supersededBy'] is not None and ev['expired'] is True and an['expired'] is True) else 1)
" && { say PASS "T9c 旧证据与旧标注过期标识可见（旧分析不作为当前有效）"; PASS=$((PASS+1)); } || { say FAIL "T9c 过期标识缺失"; FAIL=$((FAIL+1)); }

say INFO "===== 摘要：PASS=$PASS FAIL=$FAIL ====="
say INFO "注意：本脚本只覆盖既有路径回归（R3-R6）。真实入口R1/R2/R7待A的CONTRACT给出路由后另行执行。"
