// SS-06e/f 复测：按真实 payload 结构验证「纠正后仅相关域变更」
const B = "http://127.0.0.1:3469";
const call = async (p, m = "GET", b) => {
  const r = await fetch(B + p, { method: m, headers: b ? { "Content-Type": "application/json" } : {}, body: b ? JSON.stringify(b) : undefined });
  return { s: r.status, d: await r.json().catch(() => ({})) };
};
(async () => {
  await call("/api/v5-preview/demo/reset", "POST", {});
  const adv = async () => {
    for (let i = 0; i < 30; i++) {
      const st = (await call("/api/v5-preview/demo/story")).d;
      if (st.mode !== "story" || st.step.decision) return st;
      const pj = (await call("/api/v5-preview/project")).d;
      const r = await call("/api/v5-preview/demo/story", "POST", { action: "advance", requestId: "dqa-dm-" + Math.random().toString(16).slice(2, 8), expectedVersion: pj.version, fromStepId: st.step.stepId });
      if (r.s !== 200) return st;
    }
    return null;
  };
  await adv();
  const before = (await call("/api/v5-preview/project")).d;
  const st = (await call("/api/v5-preview/demo/story")).d;
  const dec = await call("/api/v5-preview/demo/story", "POST", { action: "decide", requestId: "dqa-dm-dec-" + Math.random().toString(16).slice(2, 6), expectedVersion: before.version, fromStepId: st.step.stepId, decision: "correct", note: "D域diff复测" });
  const after = (await call("/api/v5-preview/project")).d;
  console.log("decide status:", dec.s);
  console.log("domains before:", JSON.stringify(before.domains).slice(0, 420));
  console.log("domains after :", JSON.stringify(after.domains).slice(0, 420));
  console.log("domains changed:", JSON.stringify(before.domains) !== JSON.stringify(after.domains));
  console.log("todo before:", JSON.stringify(before.todo).slice(0, 300));
  console.log("todo after :", JSON.stringify(after.todo).slice(0, 300));
  console.log("todo changed:", JSON.stringify(before.todo) !== JSON.stringify(after.todo));
  console.log("messages len:", (before.messages || []).length, "->", (after.messages || []).length);
  // 域级归并：哪个 domain 项变了
  const bd = before.domains || [], ad = after.domains || [];
  for (let i = 0; i < Math.max(bd.length, ad.length); i++) {
    if (JSON.stringify(bd[i]) !== JSON.stringify(ad[i])) {
      console.log("domain item changed:", i, (bd[i] || {}).name || (bd[i] || {}).key, "->", JSON.stringify(ad[i]).slice(0, 200));
    }
  }
})();
