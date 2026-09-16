#!/usr/bin/env bash
# D路（V6-API-QA）· 新真实分析路由 annotations/analyze 回归（CONTRACT §5-§7）
# 用法：bash regress-analyze.sh <BASE_URL> <sessionId> <annotationId> <expectedVersion>
#   仅当 STATUS 声明可测试且 JIANWEI_MODEL_MODE=simulation（或A明确授权D可触发）时才允许执行！
#   MODE=real 时本脚本 analyze 调用会触发付费外部调用 —— D 禁止单独执行，只能参与A同屏验证。
set -u
BASE="${1:-}"; SID="${2:-}"; ANID="${3:-}"; V="${4:-}"
if [ -z "$BASE" ] || [ -z "$SID" ] || [ -z "$ANID" ]; then echo "用法: $0 <BASE> <sessionId> <annotationId> [expectedVersion]"; exit 2; fi
API="$BASE/api/v5-preview/remote-session"
TS=$(date +%m%d%H%M%S); RID="dqa-an-$TS-$RANDOM"
PASS=0; FAIL=0
say() { echo "[$1] $2"; }
post() { curl -sS -X POST "$API/$1" -H 'Content-Type: application/json' -d "$2"; }
getv() { curl -sS "$API/$1" | python -c "import sys,json;print(json.load(sys.stdin)$2)"; }
[ -z "$V" ] && V=$(getv "detail?sessionId=$SID" "['remoteVersion']")

# A1) 路由存在性与基本响应形状（source 字段必须显式 real|simulation）
R=$(post "annotations/analyze" "{\"requestId\":\"$RID-a1\",\"expectedVersion\":$V,\"sessionId\":\"$SID\",\"annotationId\":\"$ANID\"}")
echo "$R" | python -c "
import sys, json
d = json.load(sys.stdin)
if d.get('ok') is True and d.get('source') in ('real','simulation') and 'annotation' in d and 'remoteVersion' in d:
    sys.exit(0)
print(json.dumps(d, ensure_ascii=False)[:400]); sys.exit(1)
" && { say PASS "A1 analyze路由响应形状（source显式）"; PASS=$((PASS+1)); } || { say FAIL "A1 analyze响应形状"; FAIL=$((FAIL+1)); }
echo "$R" | python -c "
import sys, json
d = json.load(sys.stdin)
newreplies = [r for r in d['annotation']['replies'] if r['kind']=='model_real' or r.get('source')=='real']
simreplies = [r for r in d['annotation']['replies'] if r['kind']=='model_simulation']
print('source=', d.get('source'), ' model_real回复数=', len(newreplies), ' model_simulation回复数=', len(simreplies))
"
say INFO "↑ A1标签人工核对：source=real 时应有model_real回复；source=simulation 时应只有model_simulation回复"

# A2) 同requestId重放幂等：响应应与A1一致（原响应缓存），replies数不变
N1=$(echo "$R" | python -c "import sys,json;print(len(json.load(sys.stdin)['annotation']['replies']))")
V=$(getv "detail?sessionId=$SID" "['remoteVersion']")
R2=$(post "annotations/analyze" "{\"requestId\":\"$RID-a1\",\"expectedVersion\":$V,\"sessionId\":\"$SID\",\"annotationId\":\"$ANID\"}")
N2=$(echo "$R2" | python -c "import sys,json;print(len(json.load(sys.stdin)['annotation']['replies']))" 2>/dev/null || echo ERR)
if [ "$N1" = "$N2" ]; then say PASS "A2 同requestId重放不重复追加（$N1=$N2）"; PASS=$((PASS+1)); else say FAIL "A2 重放追加变化 $N1->$N2"; FAIL=$((FAIL+1)); fi

# A3) 每标注可多次（新requestId）：CONTRACT §5 允许多次分析，产生新版本回复
V=$(getv "detail?sessionId=$SID" "['remoteVersion']")
R3=$(post "annotations/analyze" "{\"requestId\":\"$RID-a3\",\"expectedVersion\":$V,\"sessionId\":\"$SID\",\"annotationId\":\"$ANID\"}")
N3=$(echo "$R3" | python -c "import sys,json;d=json.load(sys.stdin);print(len(d['annotation']['replies']))" 2>/dev/null || echo ERR)
if [ "$N3" != "ERR" ] && [ "$N3" -gt "$N1" ]; then say PASS "A3 新requestId再次分析产生新回复（$N1->$N3）"; PASS=$((PASS+1)); else say FAIL "A3 再次分析未产生新回复（$N1->$N3）"; FAIL=$((FAIL+1)); fi
echo "$R3" | python -c "
import sys, json
d = json.load(sys.stdin)
print('A3 basedOn=', json.dumps(d.get('basedOn'), ensure_ascii=False), ' usage=', json.dumps(d.get('usage'), ensure_ascii=False))
"

# A4) requestId 相同但载荷不同 → REQUEST_MISMATCH 409（幂等表防换载荷）
V=$(getv "detail?sessionId=$SID" "['remoteVersion']")
CODE=$(curl -sS -o /tmp/dqa-mm.json -w '%{http_code}' -X POST "$API/annotations/analyze" -H 'Content-Type: application/json' -d "{\"requestId\":\"$RID-a3\",\"expectedVersion\":$V,\"sessionId\":\"$SID\",\"annotationId\":\"$ANID\"}")
if [ "$CODE" = "409" ]; then say PASS "A4 同requestId换载荷被拒409"; PASS=$((PASS+1)); else say FAIL "A4 同requestId换载荷返回$CODE（预期409）"; FAIL=$((FAIL+1)); fi

# A5) 暂停会话后 analyze 被状态门阻断（409 族；记录实际错误码）
V=$(getv "detail?sessionId=$SID" "['remoteVersion']")
ANV=$(getv "detail?sessionId=$SID" "['annotations'][0]['version']")
RR=$(post "reviews" "{\"requestId\":\"$RID-pause\",\"expectedVersion\":$V,\"sessionId\":\"$SID\",\"targetType\":\"annotation\",\"targetId\":\"$ANID\",\"targetVersion\":$ANV,\"action\":\"pause_round\",\"opinion\":\"D路A5暂停门回归（合成）\"}")
echo "$RR" | python -c "import sys,json;d=json.load(sys.stdin);sys.exit(0 if d.get('sessionStatus')=='paused' else 1)" || { say FAIL "A5前置 暂停失败"; FAIL=$((FAIL+1)); exit 1; }
V=$(getv "detail?sessionId=$SID" "['remoteVersion']")
CODE=$(curl -sS -o /tmp/dqa-paused-an.json -w '%{http_code}' -X POST "$API/annotations/analyze" -H 'Content-Type: application/json' -d "{\"requestId\":\"$RID-a5\",\"expectedVersion\":$V,\"sessionId\":\"$SID\",\"annotationId\":\"$ANID\"}")
BODY=$(cat /tmp/dqa-paused-an.json)
if [ "$CODE" = "409" ]; then say PASS "A5 暂停中analyze被拒409（code=$(echo "$BODY" | python -c "import sys,json;print(json.load(sys.stdin).get('error','?'))" 2>/dev/null)）"; PASS=$((PASS+1)); else say FAIL "A5 暂停中analyze返回$CODE（预期409）body=$BODY"; FAIL=$((FAIL+1)); fi

# A6) 恢复会话（清理测试状态）
V=$(getv "detail?sessionId=$SID" "['remoteVersion']")
ANV=$(getv "detail?sessionId=$SID" "['annotations'][0]['version']")
RR=$(post "reviews" "{\"requestId\":\"$RID-resume\",\"expectedVersion\":$V,\"sessionId\":\"$SID\",\"targetType\":\"annotation\",\"targetId\":\"$ANID\",\"targetVersion\":$ANV,\"action\":\"resume_round\",\"opinion\":\"D路A6恢复（合成）\"}")
echo "$RR" | python -c "import sys,json;d=json.load(sys.stdin);sys.exit(0 if d.get('sessionStatus')=='live' else 1)" && { say PASS "A6 恢复会话"; PASS=$((PASS+1)); } || { say FAIL "A6 恢复失败"; FAIL=$((FAIL+1)); }

say INFO "===== analyze路由摘要：PASS=$PASS FAIL=$FAIL ====="
say INFO "未覆盖（另测）：R2正文注入（需A集成源码审查/真实模式脱敏证据）、MODEL_RESULT_STALE在途回包改判（需真实模式或A慢通道）、UI层标签与按钮。"
