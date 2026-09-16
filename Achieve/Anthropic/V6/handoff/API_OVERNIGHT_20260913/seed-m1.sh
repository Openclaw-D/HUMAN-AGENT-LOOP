#!/usr/bin/env bash
# A路：C-M1 案例预置（仅非模型步骤 S1 证据 + S2-Q 标注；人工纠正与三次分析留给配置后现场执行）。
# 幂等：requestId 固定（m1-seed-*），重放安全；VERSION_CONFLICT 自动重读版本重试（D 路并发写入中）。
set -u
BASE="http://127.0.0.1:3467/api/v5-preview/remote-session"
SID="rs-mtzpo3q1-j33xtuqj"

get_version() {
  curl -s --max-time 10 "$BASE" | python -c "import sys,json; print(json.load(sys.stdin)['remoteVersion'])"
}

post() {
  local path="$1" body="$2"
  for attempt in 1 2 3 4 5; do
    local ver
    ver="$(get_version)"
    local full="{\"expectedVersion\":${ver},\"sessionId\":\"${SID}\",${body}}"
    local out
    out="$(curl -s --max-time 20 -X POST "$BASE/$path" -H 'Content-Type: application/json' -d "$full")"
    if echo "$out" | grep -q '"ok":true'; then
      echo "OK $path: $(echo "$out" | head -c 120)"
      return 0
    fi
    if echo "$out" | grep -q 'VERSION_CONFLICT'; then sleep 1; continue; fi
    echo "FAIL $path: $out"
    return 1
  done
  echo "FAIL $path: VERSION_CONFLICT after retries"
  return 1
}

post "evidence" '"requestId":"m1-seed-attach-e2-01","fixtureId":"fixture-contract"'
post "evidence" '"requestId":"m1-seed-attach-e1-01","fixtureId":"fixture-equipment"'

# 找 equipment 证据 id（M1 标注绑定对象）
EVID="$(curl -s --max-time 10 "$BASE/detail?sessionId=$SID" | python -c "
import sys, json
d = json.load(sys.stdin)
evs = [e for e in d['evidence'] if e['fixtureId'] == 'fixture-equipment' and not e['expired']]
print(evs[-1]['evidenceId'] if evs else '')
")"
if [ -z "$EVID" ]; then echo "FAIL: equipment evidence not found"; exit 1; fi
echo "EVID=$EVID"

QUESTION='业务标疑（设备清单页）：客户实控人声称该数控横切机为“2021年购入、发票齐全、几乎全新”。本页清单所载：型号QM-NC2200，序列号SL-2021-0337，主机出厂日期2021-03。合同要素页载明：设备买卖合同签订于2022-05，合同价505万元。另据电费记录摘录，近6个月月均用电约4.1万kWh。请依据以上材料核对：该设备的取得/购买时点口径是否一致？如发现疑点，请列出疑点、说明依据（对应哪份材料），并给出建议向客户追问的问题。不要给出批准、否决、额度或价格建议。'
python - "$QUESTION" "$EVID" <<'PYEOF' > /tmp/m1q.json
import json, sys
q, evid = sys.argv[1], sys.argv[2]
print(json.dumps({
    "requestId": "m1-seed-annot-q1-01",
    "evidenceId": evid,
    "evidenceVersion": 1,
    "question": q,
    "rect": {"x": 0.05, "y": 0.05, "w": 0.3, "h": 0.2},
}, ensure_ascii=False))
PYEOF
BODY="$(cat /tmp/m1q.json)"
for attempt in 1 2 3 4 5; do
  ver="$(get_version)"
  full="{\"expectedVersion\":${ver},\"sessionId\":\"${SID}\",${BODY#\{}"
  out="$(curl -s --max-time 20 -X POST "$BASE/annotations" -H 'Content-Type: application/json' -d "$full")"
  if echo "$out" | grep -q '"ok":true'; then echo "OK annotate: $(echo "$out" | head -c 150)"; exit 0; fi
  if echo "$out" | grep -q 'VERSION_CONFLICT'; then sleep 1; continue; fi
  echo "FAIL annotate: $out"; exit 1
done
echo "FAIL annotate: VERSION_CONFLICT after retries"
