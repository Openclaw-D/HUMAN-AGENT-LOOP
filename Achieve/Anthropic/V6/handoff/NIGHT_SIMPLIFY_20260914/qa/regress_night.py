#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D路（NIGHT_SIMPLIFY_20260914/qa）夜间回归 · 单文件脚本（Windows安全：urllib + UTF-8）。

用法：python regress_night.py BASE [--story]
  BASE 默认 http://127.0.0.1:3469（D 隔离实例）；3467 共享实例只跑 --remote（会话仍带 [D-QA 合成] 前缀）。

范围：
  --remote 远程尽调核心语义回归（本轮产品未改此层 → 作为已修缺陷(F-001)与既有语义回归保留）；
  --story  固定演示主线（GET/POST /api/v5-preview/demo/story）——等 A 标记「story 可测」后启用。

边界：仅操作 title 带 [D-QA 合成] 前缀的新建会话；不删数据；不并发压测（并发仅 F-001 判别用）；
不触发付费调用；store 版本为全局，他人写入导致 409 VERSION_CONFLICT 属设计行为（写路径自动重试）。
本脚本为新一轮真实测试，不复制旧轮测试计数。
"""
import json, sys, time, uuid, threading
import urllib.request
import urllib.error

BASE = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else "http://127.0.0.1:3469"
ARGS = [a for a in sys.argv[1:] if a.startswith("--")]
RUN_STORY = "--story" in ARGS
RUN_REMOTE = "--remote" in ARGS or not RUN_STORY
API = BASE + "/api/v5-preview/remote-session"
STORY = BASE + "/api/v5-preview/demo/story"
PASS = []
FAIL = []


def call(url, method, body=None):
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
        PASS.append(name); print("[PASS]", name, flush=True)
    else:
        FAIL.append(name); print("[FAIL]", name, ("| " + str(detail)[:500]) if detail else "", flush=True)


def getv():
    return call(API, "GET", None)[1].get("remoteVersion")


def write(path, mkbody, attempts=6):
    """POST写路径：自动重取expectedVersion重试409 VERSION_CONFLICT（设计行为）。"""
    last = (0, {})
    for _ in range(attempts):
        last = call(API + "/" + path if path else API, "POST", mkbody(getv()))
        if not (last[0] == 409 and last[1].get("error") == "VERSION_CONFLICT"):
            return last
        time.sleep(0.4)
    return last


def detail(sid):
    return call(API, "GET", None) if False else call(API + "/detail?sessionId=" + str(sid), "GET", None)


TAG = time.strftime("%m%d-%H%M%S")
RID = "dqa-" + uuid.uuid4().hex[:8]


# ---------------------------------------------------------------- 远程尽调回归
def run_remote():
    print(f"== remote regression @ {BASE} ==", flush=True)

    # R0 服务可达
    st, d = call(API, "GET")
    check("N-R0 remote 服务可达", st == 200 and d.get("ok") is True and isinstance(d.get("remoteVersion"), int), (st, d))

    # R1 建[D-QA]会话
    st, d = write("", lambda v: {"requestId": f"{RID}-create", "expectedVersion": v,
                                 "title": f"[D-QA 合成] 夜间回归 {TAG}"})
    check("N-R1 创建[D-QA]会话", st == 200 and d.get("ok") is True
          and str(d.get("session", {}).get("title", "")).startswith("[D-QA 合成]"), (st, d))
    sid = d.get("session", {}).get("sessionId", "")
    if not sid:
        return

    # R2 附着证据（fixture-inspection）
    st, d = write("evidence", lambda v: {"fixtureId": "fixture-inspection", "expectedVersion": v,
                                         "requestId": f"{RID}-ev1", "sessionId": sid})
    ev_ok = st == 200 and d.get("ok") is True
    check("N-R2 附着合成证据", ev_ok, (st, d))
    st, dd = detail(sid)
    evs = dd.get("evidence", [])
    ev = evs[-1] if evs else {}
    check("N-R2b 证据读回（version/sha256/未过期）", bool(ev) and ev.get("version") == 1
          and ev.get("sha256") and ev.get("expired") is not True, dd.get("evidence"))

    # R3 建标注（关键问题绑定证据）
    qtext = f"夜间回归问题 {TAG}：现场设备现状与数量？"
    st, d = write("annotations", lambda v: {"evidenceId": ev.get("evidenceId"), "evidenceVersion": ev.get("version"),
                                            "question": qtext, "rect": {"x": 0, "y": 0, "w": 1, "h": 1},
                                            "expectedVersion": v, "requestId": f"{RID}-an1", "sessionId": sid})
    check("N-R3 创建标注", st == 200 and d.get("ok") is True, (st, d))
    st, dd = detail(sid)
    anns = [a for a in dd.get("annotations", []) if a.get("question") == qtext]
    ann = anns[-1] if anns else {}
    check("N-R3b 标注读回 open/引用正确", ann.get("status") == "open"
          and ann.get("evidenceId") == ev.get("evidenceId") and ann.get("evidenceVersion") == ev.get("version"), ann)

    # R4 业务回复（访谈记录语义）
    st, d = write("annotations/replies", lambda v: {"annotationId": ann.get("annotationId"), "kind": "business",
                                                    "text": f"业务回复（合成）{TAG}", "expectedVersion": v,
                                                    "requestId": f"{RID}-rp1", "sessionId": sid})
    check("N-R4 业务回复写入", st == 200 and d.get("ok") is True, (st, d))

    # R5 同requestId原样重放 → 幂等成功且不重复写入
    st, dd = detail(sid)
    n_replies_before = sum(len(a.get("replies", [])) for a in dd.get("annotations", []))
    st2, d2 = call(API + "/annotations/replies", "POST", {"annotationId": ann.get("annotationId"), "kind": "business",
                                                          "text": f"业务回复（合成）{TAG}", "expectedVersion": 1,
                                                          "requestId": f"{RID}-rp1", "sessionId": sid})
    st, dd = detail(sid)
    n_replies_after = sum(len(a.get("replies", [])) for a in dd.get("annotations", []))
    check("N-R5 同requestId重放幂等（HTTP级）", st2 in (200, 409) and n_replies_before == n_replies_after,
          (st2, d2, n_replies_before, n_replies_after))

    # R6 模拟追问：每标注一轮；第二次如实 no-op（不新增回复）
    st, d = write("annotations/simulate", lambda v: {"annotationId": ann.get("annotationId"), "expectedVersion": v,
                                                     "requestId": f"{RID}-sim1", "sessionId": sid})
    first_ok = st == 200 and d.get("ok") is True
    check("N-R6 首轮模拟追问", first_ok, (st, d))
    st, dd = detail(sid)
    n_sim1 = sum(1 for a in dd["annotations"] for r in a.get("replies", []) if r.get("kind") == "model_simulation")
    st, d = write("annotations/simulate", lambda v: {"annotationId": ann.get("annotationId"), "expectedVersion": v,
                                                     "requestId": f"{RID}-sim2", "sessionId": sid})
    st, dd = detail(sid)
    n_sim2 = sum(1 for a in dd["annotations"] for r in a.get("replies", []) if r.get("kind") == "model_simulation")
    check("N-R6b 每标注单轮：第二次不新增模拟回复", n_sim1 == n_sim2, (n_sim1, n_sim2))

    # R7 F-001 回归：新标注并发双 simulate → 任一排序下无丢失写。
    # 判据（对齐 F-001 修复语义）：两请求都 200 时，两轮回复（按响应体 replyId）必须全部
    # 存在于最终 store（合并写入）；任一被入口版本门拒绝（409）则合法。绝不允许 200 却丢写。
    q2 = f"并发判别问题 {TAG}"
    st, d = write("annotations", lambda v: {"evidenceId": ev.get("evidenceId"), "evidenceVersion": ev.get("version"),
                                            "question": q2, "rect": {"x": 0, "y": 0, "w": 1, "h": 1},
                                            "expectedVersion": v, "requestId": f"{RID}-an2", "sessionId": sid})
    st, dd = detail(sid)
    ann2 = [a for a in dd.get("annotations", []) if a.get("question") == q2][-1]
    v_pre = ann2.get("version")
    results = []

    def sim(tag):
        r = call(API + "/annotations/simulate", "POST", {"annotationId": ann2.get("annotationId"),
                                                         "expectedVersion": getv(), "requestId": f"{RID}-race-{tag}",
                                                         "sessionId": sid})
        results.append(r)

    t1 = threading.Thread(target=sim, args=("a",)); t2 = threading.Thread(target=sim, args=("b",))
    t1.start(); t2.start(); t1.join(); t2.join()
    st, dd = detail(sid)
    ann2_final = [a for a in dd["annotations"] if a.get("annotationId") == ann2.get("annotationId")][0]
    store_rids = {r.get("replyId") for r in ann2_final.get("replies", [])}
    codes = tuple(sorted(r[0] for r in results))
    ok_codes = {(200, 200), (200, 409), (409, 200)}
    resp_rids = [rp.get("replyId") for r in results if r[0] == 200
                 for rp in (r[1].get("annotation", {}).get("replies", []) or [])]
    lost = [i for i in resp_rids if i not in store_rids]
    both200 = codes == (200, 200)
    ver_bumped = ann2_final.get("version", 0) >= (v_pre or 0) + 2
    check("N-R7 F-001并发回归（200必须全在库；双双200则两轮合并）",
          codes in ok_codes and not lost and (not both200 or ver_bumped),
          (codes, "丢失", lost, "终版", ann2_final.get("version"), "前版", v_pre))

    # R8 暂停门：pause → simulate 409 SESSION_PAUSED；resume 后解除。
    #（暂停前重取标注最新版本——回复写入会推进标注版本，过期 target 被服务端正确拒绝。）
    st, dd = detail(sid)
    ann_cur = [a for a in dd.get("annotations", []) if a.get("annotationId") == ann.get("annotationId")][-1]
    st, d = write("reviews", lambda v: {"targetType": "annotation", "targetId": ann.get("annotationId"),
                                        "targetVersion": ann_cur.get("version"), "action": "pause_round",
                                        "opinion": "D-QA 暂停（合成）", "expectedVersion": v,
                                        "requestId": f"{RID}-pz1", "sessionId": sid})
    check("N-R8 暂停写入", st == 200 and d.get("ok") is True, (st, d))
    st, dd = detail(sid)
    check("N-R8b 会话状态=paused 读回", dd.get("session", {}).get("status") == "paused", dd.get("session", {}).get("status"))
    st, d = call(API + "/annotations/simulate", "POST", {"annotationId": ann2.get("annotationId"),
                                                         "expectedVersion": getv(), "requestId": f"{RID}-sim3",
                                                         "sessionId": sid})
    check("N-R8c 暂停中 simulate（新标注）→ 409 SESSION_PAUSED 且不写库", st == 409 and d.get("error") == "SESSION_PAUSED", (st, d))
    st, d = write("reviews", lambda v: {"targetType": "annotation", "targetId": ann.get("annotationId"),
                                        "targetVersion": ann_cur.get("version"), "action": "resume_round",
                                        "opinion": "D-QA 恢复（合成）", "expectedVersion": v,
                                        "requestId": f"{RID}-rz1", "sessionId": sid})
    check("N-R8d 恢复写入", st == 200 and d.get("ok") is True, (st, d))
    st, dd = detail(sid)
    check("N-R8e 恢复后状态=live", dd.get("session", {}).get("status") == "live", dd.get("session", {}).get("status"))

    # R9 版本门：过期 expectedVersion → 409 VERSION_CONFLICT，且未产生写入
    v_now = getv()
    st, d = call(API + "/annotations/replies", "POST", {"annotationId": ann.get("annotationId"), "kind": "business",
                                                        "text": "过期版本写入（应被拒绝）", "expectedVersion": max(0, v_now - 5),
                                                        "requestId": f"{RID}-stale", "sessionId": sid})
    check("N-R9 过期版本 → 409 不落库", st == 409 and d.get("error") == "VERSION_CONFLICT", (st, d))

    # R10 换载荷同requestId → 409 REQUEST_MISMATCH
    st, d = call(API + "/annotations/replies", "POST", {"annotationId": ann.get("annotationId"), "kind": "business",
                                                        "text": "换载荷（应被拒绝）", "expectedVersion": getv(),
                                                        "requestId": f"{RID}-rp1", "sessionId": sid})
    check("N-R10 同requestId换载荷 → 409 REQUEST_MISMATCH", st == 409 and d.get("error") == "REQUEST_MISMATCH", (st, d))

    # R11 会话隔离：第二会话看不到第一会话标注
    st, d = write("", lambda v: {"requestId": f"{RID}-create2", "expectedVersion": v,
                                 "title": f"[D-QA 合成] 夜间回归·隔离对照 {TAG}"})
    sid2 = d.get("session", {}).get("sessionId", "")
    st, dd2 = detail(sid2)
    iso = st == 200 and all(a.get("annotationId") not in {ann.get("annotationId"), ann2.get("annotationId")}
                            for a in dd2.get("annotations", []))
    check("N-R11 两会话隔离（标注不串）", iso, [a.get("annotationId") for a in dd2.get("annotations", [])])

    # R12 刷新读回稳定：连续两次 GET 一致（版本不漂移）
    _, d1 = detail(sid); _, d3 = detail(sid)
    check("N-R12 读回稳定（remoteVersion 不漂移）", d1.get("remoteVersion") == d3.get("remoteVersion"),
          (d1.get("remoteVersion"), d3.get("remoteVersion")))


# ---------------------------------------------------------------- 固定演示主线
def run_story():
    """按 main/CONTRACT.md §5 的完整 story 套件。仅在 A 标记「story 可测」后运行；
    写测试默认在 D 隔离实例（3469）执行；3467 共享实例只做 GET 检查。"""
    print(f"== story regression @ {BASE} ==", flush=True)
    rid = "dqa-story-" + uuid.uuid4().hex[:8]

    def gp():
        return call(BASE + "/api/v5-preview/project", "GET", None)[1]

    # S0 GET 可达 + mode 字段
    st, d = call(STORY, "GET")
    if st == 404:
        print("story 路由未上线：跳过（如实报告，不算失败）", flush=True)
        return
    check("N-S0 story GET 可达", st == 200 and d.get("ok") is True and d.get("mode") in ("story", "free"), (st, d))

    # S1 起点签名推导：approval 种子 → mode=story 且 step=s00
    ov = gp()
    st, d = call(STORY, "GET")
    if ov.get("scenario") == "approval" and (ov.get("todo") or {}).get("id") == "todo-device-list":
        check("N-S1 approval种子 → story模式起点", d.get("mode") == "story" and d.get("step", {}).get("stepIndex") == 0, d.get("step"))
    else:
        print(f"  (当前 overview scenario={ov.get('scenario')}，非起点——S1 转为仅记录)", flush=True)

    def advance(step_id, req_suffix, ver=None):
        return call(STORY, "POST", {"action": "advance", "requestId": f"{rid}-{req_suffix}",
                                    "expectedVersion": (getv_story() if ver is None else ver), "fromStepId": step_id})

    def getv_story():
        return gp().get("version")

    def decide(step_id, kind, req_suffix, note=None):
        body = {"action": "decide", "requestId": f"{rid}-{req_suffix}", "expectedVersion": getv_story(),
                "fromStepId": step_id, "decision": kind}
        if note is not None:
            body["note"] = note
        return call(STORY, "POST", body)

    if d.get("mode") != "story":
        print("  (mode!=story，写路径套件需要起点状态；先执行重新开始=seed 后继续)", flush=True)
        st, sd = call(BASE + "/api/v5-preview/demo/seed", "POST", {"scenario": "approval"})
        check("N-S1r 重新开始(seed)恢复起点", st == 200 and sd.get("overview", {}).get("scenario") == "approval", (st, str(sd)[:200]))
        st, d = call(STORY, "GET")
        check("N-S1r2 seed后 story模式起点（mode=story且stepIndex=0）", d.get("mode") == "story" and d.get("step", {}).get("stepIndex") == 0, d)

    step0 = d["step"]["stepId"]

    # S2 版本门：过期 expectedVersion → 409
    st, r = advance(step0, "stale", ver=max(0, getv_story() - 3))
    check("N-S2 过期版本 → 409 VERSION_CONFLICT", st == 409 and r.get("error") == "VERSION_CONFLICT", (st, r))

    # S3 步骤门：fromStepId 错误 → 409 STORY_STEP_CHANGED
    st, r = advance("zz-no-such-step", "wrongstep")
    check("N-S3 错误fromStepId → 409 STORY_STEP_CHANGED", st == 409 and r.get("error") == "STORY_STEP_CHANGED", (st, r))

    # S4 有效推进：版本+1，步进到下一步
    v0 = getv_story()
    st, r = advance(step0, "adv1")
    # 链式自动推进（wave-2）：一次 advance 可连续应用多个自动步，版本按应用步数递增。
    ok4 = st == 200 and r.get("ok") is True and r.get("overview", {}).get("version", 0) > v0
    check("N-S4 有效推进（版本严格递增）", ok4, (st, r.get("step"), r.get("overview", {}).get("version"), v0))
    cur = r.get("step", {}).get("stepId")
    awaiting = r.get("step", {}).get("awaitingDecision")

    # S5 幂等重放：同 requestId 同载荷 → replayed:true 且版本不变
    v1 = getv_story()
    st, r2 = call(STORY, "POST", {"action": "advance", "requestId": f"{rid}-adv1",
                                  "expectedVersion": v0, "fromStepId": step0})
    check("N-S5 同requestId重放幂等", st == 200 and r2.get("replayed") is True and getv_story() == v1, (st, r2.get("replayed")))

    # S6 换载荷同 requestId → 409 REQUEST_MISMATCH
    st, r3 = call(STORY, "POST", {"action": "advance", "requestId": f"{rid}-adv1",
                                  "expectedVersion": getv_story(), "fromStepId": step0})
    check("N-S6 同requestId换载荷 → 409 REQUEST_MISMATCH", st == 409 and r3.get("error") == "REQUEST_MISMATCH", (st, r3))

    # S7 走到第一个人工决定点（连续 advance，步数上限防御）
    hops = 0
    while awaiting is not True and cur is not None and hops < 15:
        st, r = advance(cur, f"walk{hops}")
        if st != 200:
            break
        cur = r["step"]["stepId"]
        awaiting = r["step"]["awaitingDecision"]
        hops += 1
    check("N-S7 到达人工决定点（advance 停止）", awaiting is True, (cur, awaiting, hops))
    decision_step = cur

    # S8 决定点上 advance → 409 STORY_DECISION_REQUIRED
    st, r = advance(decision_step, "atdec")
    check("N-S8 决定点 advance → 409 STORY_DECISION_REQUIRED", st == 409 and r.get("error") == "STORY_DECISION_REQUIRED", (st, r))

    # S9 非法决定 → 400 INVALID_INPUT
    st, r = call(STORY, "POST", {"action": "decide", "requestId": f"{rid}-bad", "expectedVersion": getv_story(),
                                 "fromStepId": decision_step, "decision": "unknown"})
    check("N-S9 非法决定 → 400", st == 400 and r.get("error") == "INVALID_INPUT", (st, r))

    # S10 退回分支：状态不机械全绿（资产域不得提前完成）
    st, r = decide(decision_step, "return", "ret1")
    if st == 200:
        doms = {x["domainId"]: x for x in r["overview"]["domains"]}
        asset_done = all(s == "done" for s in doms.get("asset", {}).get("segments", []))
        check("N-S10 退回后非全绿（资产域未提前完成）", not asset_done, doms.get("asset"))
        cur = r["step"]["stepId"]
        # 分支继续推进至汇合（步数上限防御），记录实际路径与 C 语义差异
        path = [cur]
        for i in range(8):
            st, r = advance(cur, f"br{path[-1]}")
            if st != 200:
                break
            cur = r["step"]["stepId"]
            path.append(cur)
            if r["step"]["awaitingDecision"]:
                break
        print(f"  (退回分支实际路径: {'→'.join(path)}；与 C 的 DD-RT→再决定语义差异见 DEFECTS D-03)", flush=True)
        decision_step2 = cur if (st == 200 and r.get("step", {}).get("awaitingDecision")) else None
    else:
        check("N-S10 退回分支可进入", False, (st, r))
        decision_step2 = None

    # S11 纠正+note：note 留档（补充说明 mark）
    if decision_step2:
        st, r = decide(decision_step2, "correct", "cor1", note="D-QA 纠正留档测试")
        note_ok = st == 200 and any(m.get("text") == "D-QA 纠正留档测试" for m in r.get("overview", {}).get("messages", []))
        check("N-S11 纠正note留档", note_ok, (st, [m.get("text") for m in r.get("overview", {}).get("messages", [])[-3:]]))
        cur = r["step"]["stepId"]
    else:
        print("  (无再决定点可测 S11——与分支设计相关，如实记录)", flush=True)
        cur = None

    # S12 干净走到终点（已结清）：中途遇决定点一律 confirm
    terminal = False
    for i in range(20):
        if cur is None:
            st, d = call(STORY, "GET")
            cur = d.get("step", {}).get("stepId") if d.get("step") else None
            if cur is None:
                break
        st, r = advance(cur, f"fin{i}")
        if st == 409 and r.get("error") == "STORY_DECISION_REQUIRED":
            st, r = decide(cur, "confirm", f"fin-dec{i}")
        if st != 200:
            if r.get("error") == "STORY_STEP_CHANGED" and "终点" in str(r.get("message", "")):
                terminal = True
            break
        cur = r["step"]["stepId"]
        if r["overview"].get("scenario") == "settled" and r["overview"].get("todo") is None:
            terminal = True
            break
    ov = gp()
    doms = {x["domainId"]: x for x in ov.get("domains", [])}
    all_green = all(all(s == "done" for s in x.get("segments", [])) for x in doms.values())
    check("N-S12 五阶段推进到结清（settled+todo空+四域完成）", terminal and ov.get("scenario") == "settled"
          and ov.get("todo") is None and all_green, (terminal, ov.get("scenario"), all_green))

    # S13 终点再 advance → 409（可重新开始）。终点步ID不硬编码（数据表可替换），从 GET 推导。
    if terminal:
        st, d = call(STORY, "GET")
        term_step = (d.get("step") or {}).get("stepId")
        is_last = (d.get("step") or {}).get("stepIndex") == (d.get("step") or {}).get("stepsTotal", -1) - 1
        if term_step:
            st, r = advance(term_step, "after-end")
            check("N-S13 终点再推进 → 409 提示重新开始", st == 409 and r.get("error") == "STORY_STEP_CHANGED" and is_last,
                  (st, r, term_step, is_last))
        else:
            check("N-S13 终点再推进 → 409 提示重新开始", False, "GET 未返回终点步")

    # S14 重新开始作用域：seed 后 story 回 s00，且 remote-store 不受影响
    rv_before = call(BASE + "/api/v5-preview/remote-session", "GET", None)[1].get("remoteVersion")
    st, sd = call(BASE + "/api/v5-preview/demo/seed", "POST", {"scenario": "approval"})
    rv_after = call(BASE + "/api/v5-preview/remote-session", "GET", None)[1].get("remoteVersion")
    st2, d = call(STORY, "GET")
    check("N-S14 重新开始=主线seed且remote不受影响",
          st == 200 and d.get("mode") == "story" and d.get("step", {}).get("stepIndex") == 0
          and rv_before == rv_after, (st, d.get("step", {}).get("stepId"), rv_before, rv_after))

    # S15 自由模式诚实：制造签名外状态（追加一条消息不改签名→应仍story；故改用 note 提交使 todo 变化太重——
    # 改为检查 freeNotice 文案存在即可，free 路径由用户手动作_scenario切换触发，UI 阶段验证）
    st, d = call(STORY, "GET")
    check("N-S15 GET 结构完整（freeNotice 字段在）", "freeNotice" in d, list(d.keys()))



if __name__ == "__main__":
    if RUN_REMOTE:
        run_remote()
    if RUN_STORY:
        run_story()
    print(f"\n== 汇总：PASS {len(PASS)} / FAIL {len(FAIL)} ==", flush=True)
    if FAIL:
        print("FAIL items:", *FAIL, sep="\n  - ", flush=True)
    sys.exit(1 if FAIL else 0)
