#!/usr/bin/env bash
# A路：M1 全链路 socket 级验证（3468 隔离实例 + 本地 mock 模型端点；非真实模型调用）。
# 链路：建会话→附证据→标注→真实分析①→客户补充→真实分析②→人工纠正→真实分析③→刷新读回。
set -u
BASE="http://127.0.0.1:3468/api/v5-preview/remote-session"

get_version() { curl -s --max-time 10 "$BASE" | python -c "import sys,json; print(json.load(sys.stdin)['remoteVersion'])"; }

post() {
  local path="$1" body="$2" rid="$3"
  for attempt in 1 2 3; do
    local ver
    ver="$(get_version)"
    local out
    if [ -n "$rid" ]; then
      out="$(curl -s --max-time 60 -X POST "$BASE/$path" -H 'Content-Type: application/json' -d "{\"expectedVersion\":${ver},\"requestId\":\"${rid}\",${body}}")"
    else
      out="$(curl -s --max-time 60 -X POST "$BASE/$path" -H 'Content-Type: application/json' -d "{\"expectedVersion\":${ver},${body}}")"
    fi
    if echo "$out" | grep -q '"ok":true'; then echo "$out"; return 0; fi
    if echo "$out" | grep -q 'VERSION_CONFLICT'; then sleep 1; continue; fi
    echo "FAIL $path: $out" >&2; return 1
  done
  echo "FAIL $path: VERSION_CONFLICT" >&2; return 1
}

echo "=== S0 会话"
S_OUT=$(post "session" '"title":"M1 socket验证·岐明包装机械（虚构）·合成演示"' "m1s-seed-session-01")
SID=$(echo "$S_OUT" | python -c "import sys,json; print(json.load(sys.stdin)['session']['sessionId'])")
echo "SID=$SID"

echo "=== S1-E1 设备清单证据"
post "evidence" "\"sessionId\":\"${SID}\",\"fixtureId\":\"fixture-equipment\"" "m1s-attach-e1-01" > /dev/null
post "evidence" "\"sessionId\":\"${SID}\",\"fixtureId\":\"fixture-contract\"" "m1s-attach-e2-01" > /dev/null
EVID=$(curl -s --max-time 10 "$BASE/detail?sessionId=$SID" | python -c "
import sys, json
d = json.load(sys.stdin)
evs = [e for e in d['evidence'] if e['fixtureId'] == 'fixture-equipment' and not e['expired']]
print(evs[-1]['evidenceId'])")
echo "EVID=$EVID"

echo "=== S2-Q 标注"
python - "$SID" "$EVID" <<'PYEOF' > /tmp/m1s-q.json
import json, sys
sid, evid = sys.argv[1], sys.argv[2]
q = "业务标疑（设备清单页）：客户实控人声称该数控横切机为“2021年购入、发票齐全、几乎全新”。本页清单所载：型号QM-NC2200，序列号SL-2021-0337，主机出厂日期2021-03。合同要素页载明：设备买卖合同签订于2022-05，合同价505万元。另据电费记录摘录，近6个月月均用电约4.1万kWh。请依据以上材料核对：该设备的取得/购买时点口径是否一致？如发现疑点，请列出疑点、说明依据（对应哪份材料），并给出建议向客户追问的问题。不要给出批准、否决、额度或价格建议。"
print(json.dumps({"sessionId": sid, "requestId": "m1s-annot-q1-01", "evidenceId": evid, "evidenceVersion": 1, "question": q, "rect": {"x": 0.05, "y": 0.05, "w": 0.3, "h": 0.2}}, ensure_ascii=False))
PYEOF
for attempt in 1 2 3; do
  ver="$(get_version)"
  python - "$ver" <<'PYEOF' > /tmp/m1s-q-full.json
import json, sys
body = json.load(open('/tmp/m1s-q.json', encoding='utf-8'))
body['expectedVersion'] = int(sys.argv[1])
print(json.dumps(body, ensure_ascii=False))
PYEOF
  OUT=$(curl -s --max-time 30 -X POST "$BASE/annotations" -H 'Content-Type: application/json' --data-binary @/tmp/m1s-q-full.json)
  echo "$OUT" | grep -q '"ok":true' && break
  sleep 1
done
ANN=$(echo "$OUT" | python -c "import sys,json; print(json.load(sys.stdin)['annotation']['annotationId'])")
echo "ANN=$ANN"

analyze() {
  echo "=== $1"
  OUT=$(post "annotations/analyze" "\"sessionId\":\"${SID}\",\"annotationId\":\"${ANN}\"" "$2")
  echo "$OUT" | python -c "
import sys, json
d = json.load(sys.stdin)
print('source:', d.get('source'), '| basedOn:', d.get('basedOn'), '| usage:', d.get('usage'))
real = [r for r in d['annotation']['replies'] if r['kind'] == 'model_real']
print('model_real replies total:', len(real))
print('latest finding:', next((r['text'][:150] for r in reversed(real) if '疑点' in r['text']), 'N/A'))"
}

reply() {
  echo "=== $1"
  python - "$SID" "$ANN" "$3" <<'PYEOF' > /tmp/m1s-r.json
import json, sys
sid, ann, text = sys.argv[1], sys.argv[2], sys.argv[3]
print(json.dumps({"sessionId": sid, "annotationId": ann, "requestId": sys.argv[4] if len(sys.argv) > 4 else "rid", "kind": "business", "text": text}, ensure_ascii=False))
PYEOF
  for attempt in 1 2 3; do
    ver="$(get_version)"
    python - "$ver" <<'PYEOF' > /tmp/m1s-r-full.json
import json, sys
body = json.load(open('/tmp/m1s-r.json', encoding='utf-8'))
body['expectedVersion'] = int(sys.argv[1])
print(json.dumps(body, ensure_ascii=False))
PYEOF
    OUT=$(curl -s --max-time 30 -X POST "$BASE/annotations/replies" -H 'Content-Type: application/json' --data-binary @/tmp/m1s-r-full.json)
    echo "$OUT" | grep -q '"ok":true' && { echo "reply ok"; return 0; }
    sleep 1
  done
  echo "reply FAIL: $OUT"
}

analyze "S2-A1 真实分析①（仅早期资料）" "m1s-analyze-01"
reply "S3-R1 客户补充（business）" x "客户补充说明（实控人口述，业务代录）：2021年11月与厂方签了订购协议并付定金，设备主机2021年3月出厂；2022年5月正式签买卖合同、6月付清尾款、7月到厂安装。我们说的“2021年购入”是从签订订购协议算起。订购协议、定金收据和尾款付款凭证都可以补交。"
analyze "S3-A2 真实分析②（读到客户补充）" "m1s-analyze-02"
reply "S4-R2a 人工更正（domain）" y "人工更正：首次沟通纪要中“年产值约450万元”系业务记录笔误，经与客户财务人员核对应为“月产值约450万元”，现予更正；该数字仍未经书面台账核实。更正前基于“年产值”的产能-能耗匹配分析一律作废。" "m1s-corr-01"
analyze "S4-A3 真实分析③（读到人工纠正）" "m1s-analyze-03"

echo "=== S6 刷新读回"
curl -s --max-time 15 "$BASE/detail?sessionId=$SID" | python -c "
import sys, json
d = json.load(sys.stdin)
ann = next(a for a in d['annotations'] if a['annotationId'].startswith('an-'))
kinds = {}
for r in ann['replies']:
    kinds[r['kind']] = kinds.get(r['kind'], 0) + 1
print('读回 replies kinds:', kinds)
real = [r for r in ann['replies'] if r['kind'] == 'model_real']
decls = [r['text'][:90] for r in real if 'source=real' in r['text']]
print('三次分析声明:', len(decls))
for t in decls: print(' -', t)"