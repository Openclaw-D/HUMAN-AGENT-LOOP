// Entirely synthetic teaching inputs; values are assumptions, not forecasts.
export const OBJECTIVES = Object.freeze([
  { id: 'impact', label: '目标效果', metric: 'impactScore', direction: 'max', unit: '分', scale: [0, 100] },
  { id: 'effort', label: '节省投入', metric: 'effortPoints', direction: 'min', unit: '分', scale: [0, 100] },
  { id: 'flexibility', label: '可调整性', metric: 'flexibilityScore', direction: 'max', unit: '分', scale: [0, 100] },
  { id: 'independence', label: '减少依赖', metric: 'dependencyScore', direction: 'min', unit: '分', scale: [0, 100] },
]);
export const DEFAULT_WEIGHTS = Object.freeze({ impact: 40, effort: 30, flexibility: 20, independence: 10 });
export const DEFAULT_LIMITS = Object.freeze({ maxEffortPoints: 70, minFlexibilityScore: 40, maxDependencyScore: 60, minInformationPct: 80 });
const alternatives = () => [
  { id: 'explore', name: '轻量探索', description: '先用较少投入验证想法，保留调整方向的空间。', metrics: { impactScore: 62, effortPoints: 25, flexibilityScore: 85, dependencyScore: 20 }, informationCompleteness: 100 },
  { id: 'balanced', name: '均衡推进', description: '扩大预期效果，同时接受适度投入和协作依赖。', metrics: { impactScore: 82, effortPoints: 55, flexibilityScore: 65, dependencyScore: 35 }, informationCompleteness: 100 },
  { id: 'expand', name: '全面铺开', description: '追求较大效果，但需要更多投入、固定安排与外部配合。', metrics: { impactScore: 95, effortPoints: 92, flexibilityScore: 20, dependencyScore: 85 }, informationCompleteness: 100 },
  { id: 'flexible', name: '优先可调整', description: '将可逆性与独立性放在前面，接受较小的阶段效果。', metrics: { impactScore: 55, effortPoints: 20, flexibilityScore: 95, dependencyScore: 15 }, informationCompleteness: 100 },
];
export function createScenarios() {
  const specs = [
    { id: 'shared-choice', title: '一起选择活动方案', category: '目标权衡', question: '大家看重的目标不同，怎样形成一个有依据的共同选择？', description: '比较四种完全虚构的行动方案。参与者可以提出意见、调整目标并请助手解释取舍，由协调者记录决定。' },
    { id: 'limited-resources', title: '资源有限的取舍', category: '条件变化', question: '可用资源和配合条件发生变化，原来的选择还合适吗？', description: '本例提高投入与依赖假设，用于练习多人讨论、约束复核和重新决定。' },
    { id: 'missing-information', title: '信息不足的协作', category: '不确定性', question: '关键假设还不完整时，先补充信息，还是明确暂缓？', description: '缺失值保持未知。参与者先讨论缺口，再记录模拟信息修订并重新比较。' },
  ];
  return specs.map((spec, i) => {
    const candidates = alternatives();
    if (i === 1) {
      candidates[0].metrics.dependencyScore = 75;
      candidates[1].metrics.effortPoints = 85;
      candidates[2].metrics.effortPoints = 98;
    }
    if (i === 2) for (const c of candidates) {
      c.informationCompleteness = 60;
      c.metrics.effortPoints = null;
    }
    return { ...spec, sourceMode: 'synthetic', revision: 1, inputVersion: 1,
      weights: { ...DEFAULT_WEIGHTS }, limits: { ...DEFAULT_LIMITS }, candidates,
      evidence: [{ id: `${spec.id}-assumptions`, title: '公开合成假设', note: '全部指标由本项目人工构造，仅用于模拟目标权衡；不是真实人员资料或模型预测。', sourceMode: 'synthetic' }],
      analysis: null, decisions: [], feedback: [], evidenceChanges: [], discussion: [] };
  });
}
