// R-06 退回分支探针：s09退回 → s12门(仅confirm/correct) → s16 hold → s17门(仅confirm)；退回态不显绿
const B = "http://127.0.0.1:3469";
const call = async (p, m = "GET", b) => {
  const r = await fetch(B + p, { method: m, headers: b ? { "Content-Type": "application/json" } : {}, body: b ? JSON.stringify(b) : undefined });
  return { s: r.status, d: await r.json().catch(() => ({})) };
};
const rid = () => "dqa-ret-" + Math.random().toString(16).slice(2, 10);
(async () => {
  await call("/api/v5-preview/demo/reset", "POST", {});
  // 走到 s09
  let st = null;
  for (let i = 0; i < 30; i++) {
    st = (await call("/api/v5-preview/demo/story")).d;
    if (st.mode !== "story") break;
    if (st.step.decision) break;
    const pj = (await call("/api/v5-preview/project")).d;
    const r = await call("/api/v5-preview/demo/story", "POST", { action: "advance", requestId: rid(), expectedVersion: pj.version, fromStepId: st.step.stepId });
    if (r.s !== 200) break;
  }
  console.log("到达:", st.step.stepId, "| 决定选项:", (st.step.decision.options || []).map(o => o.kind).join("/"));
  // 退回
  const pj = (await call("/api/v5-preview/project")).d;
  const ret = await call("/api/v5-preview/demo/story", "POST", { action: "decide", requestId: rid(), expectedVersion: pj.version, fromStepId: st.step.stepId, decision: "return", note: "D退回分支探针" });
  console.log("s09 return:", ret.s, ret.d.ok === true ? "ok" : JSON.stringify(ret.d).slice(0, 200));
  // 退回后即时域状态（未解决保持：相关域不得绿）
  const p1 = (await call("/api/v5-preview/project")).d;
  const dd = (p1.domains || []).map(x => x.domainId + ":" + x.judgmentStatus).join(" ");
  console.log("退回即时域状态:", dd);
  console.log("退回即时todo:", JSON.stringify(p1.todo).slice(0, 220));
  // 推进到下一决定门（应为 s12）
  const walk = async (max = 12) => {
    for (let i = 0; i < max; i++) {
      const s = (await call("/api/v5-preview/demo/story")).d;
      if (s.mode !== "story") return s;
      if (s.step.decision) return s;
      const pp = (await call("/api/v5-preview/project")).d;
      const r = await call("/api/v5-preview/demo/story", "POST", { action: "advance", requestId: rid(), expectedVersion: pp.version, fromStepId: s.step.stepId });
      if (r.s !== 200) { console.log("  walk advance 停:", r.s, JSON.stringify(r.d).slice(0, 150)); return s; }
    }
    return null;
  };
  st = await walk();
  console.log("退回后门:", st && st.step && st.step.stepId, "|", st && st.step && st.step.title);
  if (st && st.step && st.step.decision) {
    const kinds = (st.step.decision.options || []).map(o => o.kind);
    console.log("s12 选项:", kinds.join("/"), "| 提示:", st.step.decision.prompt.slice(0, 120));
    console.log("s12 无return选项:", !kinds.includes("return"));
    // s12 纠正（保持未解决语义下再次补充后的合法终态之一）
    const pj2 = (await call("/api/v5-preview/project")).d;
    const dec = await call("/api/v5-preview/demo/story", "POST", { action: "decide", requestId: rid(), expectedVersion: pj2.version, fromStepId: st.step.stepId, decision: "correct", note: "D退回后再判断" });
    console.log("s12 correct:", dec.s);
  }
  // 继续走到 s17 门
  st = await walk();
  console.log("下一门:", st && st.step && st.step.stepId, "|", st && st.step && st.step.title);
  if (st && st.step && st.step.decision) {
    const kinds = (st.step.decision.options || []).map(o => o.kind);
    console.log("s17 选项:", kinds.join("/"), "| 仅confirm:", kinds.length === 1 && kinds[0] === "confirm");
    console.log("s17 提示:", st.step.decision.prompt.slice(0, 120));
  }
  // 规则化措辞检查（不得把演示次数写成业务规则）
  const proj = (await call("/api/v5-preview/project")).d;
  const allText = JSON.stringify(proj);
  const ruleized = /业务规则|只能退回一次|仅限退回一次|次数用完|用完次数/.test(allText);
  console.log("规则化措辞(业务规则/次数用完等):", ruleized ? "发现!" : "无");
  console.log("含「本演示内」限定词:", allText.includes("本演示内"));
})();
