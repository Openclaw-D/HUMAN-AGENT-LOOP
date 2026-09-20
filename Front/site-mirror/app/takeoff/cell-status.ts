import type { TakeoffCellView } from '../../lib/workbench/takeoff-projection';

/** Lock before work, blue wrench during work, green check complete, red X for explicit failure. */
function hasBlocker(cell: TakeoffCellView) {
  return cell.frozen || cell.needsReview || cell.items.some((item) =>
    (item.tone === 'red' && item.key !== 'cand') || ['blk', 'fup', 'stale', 'rv', 'chg'].includes(item.key));
}
export function cellStatus(cell: TakeoffCellView, cells: TakeoffCellView[] = []): { color: 'gray' | 'blue' | 'green' | 'red'; icon: 'lock' | 'wrench' | 'check' | 'cross'; label: string } {
  if (cell.items.some((item) => item.key === 'gate' && item.tone === 'red')) {
    return { color: 'red', icon: 'cross', label: '准入检查未通过，点击查看原因' };
  }
  if (blockingPredecessor(cell, cells)) {
    return { color: 'gray', icon: 'lock', label: '尚未开始，先完成前序事项' };
  }
  const blocked = hasBlocker(cell);
  if (blocked) return { color: 'gray', icon: 'lock', label: cell.frozen ? '待复核后继续' : '待补齐条件，点击查看' };
  if (cell.completed) return { color: 'green', icon: 'check', label: '已完成' };
  if (cell.running) return { color: 'blue', icon: 'wrench', label: '正在处理' };
  return { color: 'gray', icon: 'lock', label: '尚未开始，点击查看下一步' };
}

export function blockingPredecessor(cell: TakeoffCellView, cells: TakeoffCellView[]) {
  const stages = ['input', 'analysis', 'human', 'closure'];
  return cells.filter((prior) => prior.domain === cell.domain && stages.indexOf(prior.row) < stages.indexOf(cell.row) && hasBlocker(prior))
    .sort((a,b) => stages.indexOf(a.row) - stages.indexOf(b.row))[0];
}
