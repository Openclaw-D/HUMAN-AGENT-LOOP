// Deterministic, conservative routing. The model never chooses its own tier.
// An uncertain or decision-like request goes to Pro; routing does not approve an action.
export function routeAssistantQuestion({ question, context } = {}) {
  const q = typeof question === 'string' ? question.trim() : '';
  if (!q || context?.decisionTask) return 'complex';
  // This is a transport choice, not a truth claim. Numeric business comparisons
  // require structured values and are deliberately excluded from the simple lane.
  if (/^[01]\s*(?:是(?:不是|否)?等于|等于|==|=)\s*[01][？?。\s]*$/.test(q)) return 'simple';
  if (q.length > 100 || /批准|审批|授信|额度|违约|概率|预测|定价|法务|冲突|矛盾|是否超过|高于|低于|大于|小于|万元|元/.test(q)) return 'complex';
  if (/^(?:请)?(?:概括|总结|提取|列出|整理)/.test(q) && (context?.evidencePack?.snippets?.length ?? 0) <= 3) return 'simple';
  return 'complex';
}
