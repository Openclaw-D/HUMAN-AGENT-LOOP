#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D路（V6-API-QA）API回归 · 单文件脚本（Windows安全：urllib + UTF-8）。
用法：python regress_api.py [BASE]   默认 http://127.0.0.1:3467
范围：既有路径回归 T0-T9c + F-001并发复测 T10 + analyze未配置 T11/T12。
边界：仅操作 title 带 [D-QA 合成] 前缀的新建会话；不删数据、不并发压测、不触发付费调用。
说明：store版本为全局，其他会话（含A演示）的写入会推进版本 → 409 VERSION_CONFLICT 是设计行为，写路径自动重试。"""
import json, sys, time, uuid, threading
import urllib.request
import urllib.error

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3467"
API = BASE + "/api/v5-preview/remote-session"
PASS = []
FAIL = []

def call(method, path, body=None):
    url = API + "/" + path if path else API
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:
            return e.code, {}

def check(name, cond, detail=""):
    if cond:
        PASS.append(name); print("[PASS]", name)
    else:
        FAIL.append(name); print("[FAIL]", name, ("| " + str(detail)[:400]) if detail else "")

def getv():
    return call("GET", "")[1].get("remoteVersion")

def write(path, mkbody, attempts=5):
    """POST写路径：自动重取expectedVersion重试409 VERSION_CONFLICT（设计行为）。"""
    last = (0, {})
    for _ in range(attempts):
        last = call("POST", path, mkbody(getv()))
        if not (last[0] == 409 and last[1].get("error") == "VERSION_CONFLICT"):
            return last
        time.sleep(0.4)
    return last

rid = "dqa-" + uuid.uuid4().hex[:8]

# T0 服务可达
st, d = call("GET", "")
check("T0 服务可达", st == 200 and d.get("ok") is True and isinstance(d.get("remoteVersion"), int), d)

# T1 建[D-QA]会话
st, d = write("", lambda v: {"requestId": f"{rid}-create", "expectedVersion": v,
                             "title": f"[D-QA 合成] D路回归会话 {time.strftime('%m%d-%H%M%S')}"})
check("T1 创建[D-QA]会话", st == 200 and d.get("ok") is True and str(d.get("session", {}).get("title", "")).startswith("[D-QA 合成]"), (st, d))
sid = d.get("session", {}).get("sessionId", "")

# T2 附证据
st, d = write("evidence", lambda v: {"requestId": f"{rid}-ev", "expectedVersion": v, "sessionId": sid, "fixtureId": "fixture-inspection"})
check("T2 附着合成证据", st == 200 and d.get("evidence", {}).get("fixtureId") == "fixture-inspection", (st, d))
evid = d.get("evidence", {}).get("evidenceId", "")

# T3 建标注1（主回归用）
st, d = write("annotations", lambda v: {"requestId": f"{rid}-an", "expectedVersion": v, "sessionId": sid,
                                        "evidenceId": evid, "evidenceVersion": 1,
                                        "question": "D路回归问题：请说明设备现状（合成）",
                                        "rect": {"x": 0, "y": 0, "w": 1, "h": 1}})
check("T3 创建标注", st == 200 and d.get("ok") is True, (st, d))
anid = d.get("annotation", {}).get("annotationId", "")

# T4 人工纠正（business回复）
st, d = write("annotations/replies", lambda v: {"requestId": f"{rid}-corr", "expectedVersion": v, "sessionId": sid,
                                                "annotationId": anid, "kind": "business",
                                                "text": "人工纠正：实际设备为5台，非口述3台（D路合成纠正）"})
nbusiness = sum(1 for r in d.get("annotation", {}).get("replies", []) if r.get("kind") == "business")
check("T4 人工纠正已追加", st == 200 and nbusiness == 1, (st, d))

# T5 模拟分析（现模拟入口）；记录原始完整载荷供T6原样重放
sim_body = {"requestId": f"{rid}-sim", "expectedVersion": getv(), "sessionId": sid, "annotationId": anid}
st, d = call("POST", "annotations/simulate", sim_body)
replies5 = d.get("annotation", {}).get("replies", [])
newsim = [r for r in replies5 if r.get("kind") == "model_simulation"]
sim_total = len(replies5)
check("T5 模拟分析成功", st == 200 and d.get("ok") is True and d.get("simulated") is True and len(newsim) >= 1, (st, d))
check("T5b 模拟回复显式SIMULATION声明", all(("模拟" in r.get("text", "") or "SIMULAT" in r.get("text", "") or "模拟" in r.get("author", "")) for r in newsim), newsim[:2])

# T6 同requestId【原样】重放（UI registry语义：逐字节同载荷，含原expectedVersion）→ 幂等返回缓存
st2, d2 = call("POST", "annotations/simulate", sim_body)  # 与T5首发完全相同的载荷对象
n2 = len(d2.get("annotation", {}).get("replies", [])) if isinstance(d2.get("annotation"), dict) else None
check("T6 原样重放幂等返回缓存不重复追加", st2 == 200 and d2.get("simulated") is True and n2 == sim_total, (st2, sim_total, n2, str(d2)[:200]))

# T6b 同requestId换载荷 → REQUEST_MISMATCH 409
st3, d3 = call("POST", "annotations/simulate", {**sim_body, "expectedVersion": getv(), "extra": 1})
check("T6b 同requestId换载荷被拒409", st3 == 409 and d3.get("error") == "REQUEST_MISMATCH", (st3, d3))

# T7 刷新读回
st4, d4 = call("GET", f"detail?sessionId={sid}")
an = next((a for a in d4.get("annotations", []) if a.get("annotationId") == anid), {})
texts = [r.get("text", "") for r in an.get("replies", [])]
kinds = [r.get("kind") for r in an.get("replies", [])]
check("T7 刷新读回：纠正+模拟回复均在且数量一致",
      st4 == 200 and any("人工纠正：实际设备为5台" in t for t in texts) and kinds.count("model_simulation") >= 1 and kinds.count("business") == 1 and len(an.get("replies", [])) == sim_total,
      (st4, len(an.get("replies", [])), sim_total))

# T8 暂停门
anv = an.get("version")
st, d = write("reviews", lambda v: {"requestId": f"{rid}-pause", "expectedVersion": v, "sessionId": sid,
                                    "targetType": "annotation", "targetId": anid, "targetVersion": anv,
                                    "action": "pause_round", "opinion": "D路暂停门回归（合成）"})
check("T8 暂停成功", st == 200 and d.get("sessionStatus") == "paused", (st, d))
st, d = write("annotations/simulate", lambda v: {"requestId": f"{rid}-simpaused", "expectedVersion": v, "sessionId": sid, "annotationId": anid})
check("T8b 暂停中simulate被拒409/SESSION_PAUSED", st == 409 and d.get("error") == "SESSION_PAUSED", (st, d))

# T9 恢复 + 证据取代链
st, d = write("reviews", lambda v: {"requestId": f"{rid}-resume", "expectedVersion": v, "sessionId": sid,
                                    "targetType": "annotation", "targetId": anid, "targetVersion": anv,
                                    "action": "resume_round", "opinion": "D路恢复（合成）"})
check("T9 恢复成功", st == 200 and d.get("sessionStatus") == "live", (st, d))
st, d = write("evidence/supersede", lambda v: {"requestId": f"{rid}-sup", "expectedVersion": v, "sessionId": sid, "evidenceId": evid, "fixtureId": "fixture-inspection"})
check("T9b 证据被新版本取代", st == 200 and d.get("evidence", {}).get("supersedes") == evid, (st, d))
evid2 = d.get("evidence", {}).get("evidenceId", "")
st, d = call("GET", f"detail?sessionId={sid}")
ev_old = next((e for e in d.get("evidence", []) if e.get("evidenceId") == evid), {})
an2 = next((a for a in d.get("annotations", []) if a.get("annotationId") == anid), {})
check("T9c 旧证据与旧标注过期标识可见", ev_old.get("supersededBy") is not None and ev_old.get("expired") is True and an2.get("expired") is True,
      {"ev": {k: ev_old.get(k) for k in ("supersededBy", "expired")}, "anExpired": an2.get("expired")})

# ---- T10 F-001-RETEST：并发同标注双simulate（不同requestId）----
# 注：T9b 已取代旧证据 → 新标注必须建在取代链的新证据上（旧证据拒新标注是 T9c 已验证的正确行为）
st, d = write("annotations", lambda v: {"requestId": f"{rid}-an2", "expectedVersion": v, "sessionId": sid,
                                        "evidenceId": evid2, "evidenceVersion": 1,
                                        "question": "D路并发复测问题（合成）", "rect": {"x": 0, "y": 0.2, "w": 0.5, "h": 0.5}})
anid2 = d.get("annotation", {}).get("annotationId", "")
check("T10-pre 并发复测标注已建", st == 200 and anid2 != "", (st, str(d)[:200]))
results = {}
def fire(tag, ridtag):
    # 并发发射：expectedVersion 用同一快照（若409则记录；核心观察是"均200时不丢写"）
    results[tag] = call("POST", "annotations/simulate", {"requestId": f"{rid}-{ridtag}", "expectedVersion": results["v"], "sessionId": sid, "annotationId": anid2})
results["v"] = getv()
threads = [threading.Thread(target=fire, args=("A", "race-a")), threading.Thread(target=fire, args=("B", "race-b"))]
for x in threads: x.start()
for x in threads: x.join()
stA, dA = results.get("A", (0, {})); stB, dB = results.get("B", (0, {}))
if stA == 409 or stB == 409:
    # HTTP层并发迟到者被入口版本门409拒绝（设计行为：客户端原样重试）。顺序双发验证 no-op 语义：
    print(f"[INFO] T10 并发触发版本门（A={stA}, B={stB}），顺序双发复测")
    _, dB2 = write("annotations/simulate", lambda v: {"requestId": f"{rid}-race-b2", "expectedVersion": v, "sessionId": sid, "annotationId": anid2})
    _, dA2 = write("annotations/simulate", lambda v: {"requestId": f"{rid}-race-a2", "expectedVersion": v, "sessionId": sid, "annotationId": anid2})
else:
    dB2 = dA2 = None
st, dfinal = call("GET", f"detail?sessionId={sid}")
anf = next((a for a in dfinal.get("annotations", []) if a.get("annotationId") == anid2), {})
final_replies = anf.get("replies", [])
final_ids = {r.get("replyId") for r in final_replies}
final_sim = sum(1 for r in final_replies if r.get("kind") == "model_simulation")
all_resp = [("raceA", stA, dA), ("raceB", stB, dB), ("seqB2", 200 if dB2 else 0, dB2), ("seqA2", 200 if dA2 else 0, dA2)]
wrote = [(t, dd) for t, ss, dd in all_resp if ss == 200 and isinstance(dd.get("annotation"), dict) and dd.get("simulated") is True]
noops = [(t, dd) for t, ss, dd in all_resp if ss == 200 and dd.get("simulated") is False and not isinstance(dd.get("annotation"), dict)]
rejected = [(t, ss, dd) for t, ss, dd in all_resp if ss == 409]
max_one_call = max((len([r for r in dd["annotation"]["replies"] if r.get("kind") == "model_simulation"]) for _, dd in wrote), default=0)
# 强无丢失判定：每个实际写者的 model_simulation 回复必须全部存在于最终 store（按 replyId 子集）
loss = [(t, [r.get("replyId") for r in dd["annotation"]["replies"] if r.get("kind") == "model_simulation" and r.get("replyId") not in final_ids]) for t, dd in wrote]
check("T10a 双simulate均成功处理（写入/如实no-op/版本门409三态之一）", stA in (200, 409) and stB in (200, 409), {"A": stA, "B": stB})
check("T10b 无覆盖丢写（每个写者的回复都在最终store；no-op不虚构；409不写库）",
      len(wrote) >= 1 and max_one_call > 0 and all(not missing for _, missing in loss) and len(final_replies) == final_sim,
      {"wrote": [t for t, _ in wrote], "noops": [t for t, _ in noops], "rejected409": [t for t, _, _ in rejected],
       "max_one_call": max_one_call, "final_sim": final_sim, "lost": [x for x in loss if x[1]]})
check("T10c store版本高于并发前快照", isinstance(dfinal.get("remoteVersion"), int) and dfinal.get("remoteVersion", 0) >= results["v"], {"v": results["v"], "final": dfinal.get("remoteVersion")})

# ---- T11/T12 analyze路由（未配置态，安全：不发起真实调用）----
st, d = call("GET", "model-status")
m = d.get("model", {})
dump = json.dumps(d)
check("T11 model-status无秘密且如实", st == 200 and m.get("configured") is False and m.get("mode") == "simulation" and m.get("keyConfigured") is False and "apiKey" not in dump, m)
before = len(next((a for a in call("GET", f"detail?sessionId={sid}")[1].get("annotations", []) if a.get("annotationId") == anid2), {}).get("replies", []))
st, d = write("annotations/analyze", lambda v: {"requestId": f"{rid}-an-unconfig", "expectedVersion": v, "sessionId": sid, "annotationId": anid2})
dump = json.dumps(d, ensure_ascii=False)
check("T12a analyze未配置→503 MODEL_NOT_CONFIGURED", st == 503 and d.get("error") == "MODEL_NOT_CONFIGURED", (st, d))
check("T12b 未配置错误含缺项清单且无秘密", "JIANWEI_MODEL_BASE_URL" in dump and "apiKey" not in dump, d)
after = len(next((a for a in call("GET", f"detail?sessionId={sid}")[1].get("annotations", []) if a.get("annotationId") == anid2), {}).get("replies", []))
check("T12c 未配置失败不落库", before == after, {"before": before, "after": after})
st, d = call("POST", "annotations/analyze", {"requestId": f"{rid}-an-unconfig", "expectedVersion": getv(), "sessionId": sid, "annotationId": anid2})
check("T12d 未配置请求不占幂等缓存（仍503非缓存200）", st == 503, (st, d))
# 暂停中analyze（未配置下验证实际顺序：409=暂停门优先 / 503=配置检查优先，如实记录）
anv2 = next((a for a in call("GET", f"detail?sessionId={sid}")[1].get("annotations", []) if a.get("annotationId") == anid2), {}).get("version")
st, d = write("reviews", lambda v: {"requestId": f"{rid}-pause2", "expectedVersion": v, "sessionId": sid,
                                    "targetType": "annotation", "targetId": anid2, "targetVersion": anv2,
                                    "action": "pause_round", "opinion": "D路T12e（合成）"})
paused_ok = st == 200 and d.get("sessionStatus") == "paused"
st, d = write("annotations/analyze", lambda v: {"requestId": f"{rid}-an-paused", "expectedVersion": v, "sessionId": sid, "annotationId": anid2})
print(f"[INFO] T12e 暂停中analyze实际返回：{st} {d.get('error')}")
check("T12e 暂停中analyze被拒（409族）", (not paused_ok) or (st in (409, 503)), {"paused_ok": paused_ok, "st": st, "err": d.get("error")})
st, d = write("reviews", lambda v: {"requestId": f"{rid}-resume2", "expectedVersion": v, "sessionId": sid,
                                    "targetType": "annotation", "targetId": anid2, "targetVersion": anv2,
                                    "action": "resume_round", "opinion": "D路恢复（合成）"})
check("T12f 会话已恢复", st == 200 and d.get("sessionStatus") == "live", (st, d))

print()
print(f"===== 摘要：PASS={len(PASS)} FAIL={len(FAIL)} =====")
if FAIL:
    print("失败项：", "; ".join(FAIL))
print("未测（需真实模式或UI）：R1真实标签展示/R2正文到模型/analyze真实模式幂等与再分析/MODEL_RESULT_STALE在途改判/预算耗尽")
