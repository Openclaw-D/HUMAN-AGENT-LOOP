import { evaluate } from './analysis.mjs';
export const ASSISTANTS = Object.freeze({ planner: '规划助手', challenger: '质疑助手', summarizer: '归纳助手' });
// Transparent local simulation. No model endpoint or paid API is contacted.
export function assistantReply(state, assistantId, question) {
  const analysis = evaluate(state), feasible = analysis.candidates.filter(c => c.eligible);
  const recommended = feasible[0], blockers = analysis.candidates.filter(c => !c.eligible);
  if (assistantId === 'planner') {
    const focus = /信息|证据|假设|缺失/.test(question) ? '先确认缺失的信息，再比较目标，最后记录人的选择。' : '先确认大家的共同目标，再按边界筛选方案，最后讨论可以接受的取舍。';
    return `${focus}\n当前有 ${feasible.length} 个方案满足已设边界。${recommended ? `当前规则排序首选为“${recommended.name}”，但它不构成协调者的决定。` : '目前没有可选方案，可以补充模拟信息或记录暂缓。'}\n你们可以比较目标效果、投入程度、可调整性与依赖程度；请各参与者说明自己最在意的目标。`;
  }
  if (assistantId === 'challenger') return `${blockers.length ? blockers.map(c => `“${c.name}”：${c.blockers.join('；')}。`).join('\n') : '当前方案没有触及已设硬约束，但这不能证明所有假设都成立。'}\n请复核：各项数值的依据是否一致？是否忽略了某位参与者的目标？改变一项关键假设后，选择是否仍然成立？\n这些问题仅用于模拟复核，不会自动修改边界或执行决定。`;
  const comments = state.discussion.filter(m => m.kind === 'human').slice(-4), latest = state.decisions.at(-1);
  return `最近记录了 ${comments.length} 条参与者意见。${comments.length ? '\n' + comments.map(m => `${m.author}：${m.content.slice(0, 140)}`).join('\n') : '可以先请每位参与者写下自己的关注点。'}\n${latest ? `已有人工记录：${latest.outcome === 'choose' ? '选择了一个方案' : '明确暂缓'}；依据为“${latest.reason.slice(0, 180)}”。` : '协调者尚未确认决定。'}\n这是一份基于记录的模拟归纳，不表示所有参与者已同意。`;
}
