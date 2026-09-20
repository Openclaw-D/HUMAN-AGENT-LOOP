// TAKEOFF-FA-1.0.0 · 二十格单元（02_FRONTEND_SPEC §3）：
// 白圆=未完成；浅黄扇区=25% 档位进展，右上 0–90° 起顺时针；全绿=工作办结（纯绿整圆无对勾）；
// 运行=浅黄细外环；卡点=角标 '!'（不整格染红）；冻结=白霜边（CSS）+灰黑锁形。
// 圆不是手工切换器：点击只打开真实事项面板，不直接改业务状态。
import type { TakeoffCellView } from '../../lib/workbench/takeoff-projection';
import { cellAriaLabel } from '../../lib/workbench/takeoff-projection';

const SIZE = 44;
const C = SIZE / 2;
const R = 15;

function polar(angleDeg: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  return [C + R * Math.sin(a), C - R * Math.cos(a)];
}

/** 档位扇区路径：从正上方（0°）顺时针扫过 bucket% 的圆；25/50/75 → 90°/180°/270°。 */
function sectorPath(bucket: 25 | 50 | 75): string {
  const angle = bucket * 3.6;
  const [x, y] = polar(angle);
  const largeArc = angle > 180 ? 1 : 0;
  return `M ${C} ${C} L ${C} ${C - R} A ${R} ${R} 0 ${largeArc} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`;
}

function LockGlyph() {
  // 灰黑锁形（霜冻伴随文字，不用蓝色不挡内容）
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" style={{ position: 'absolute', left: 4, bottom: 4 }}>
      <rect x="1.5" y="4.5" width="7" height="4.5" rx="1" fill="none" stroke="#737373" strokeWidth="1.1" />
      <path d="M3 4.5 V3.2 a2 2 0 0 1 4 0 V4.5" fill="none" stroke="#737373" strokeWidth="1.1" />
    </svg>
  );
}

export function TakeoffCell({ cell, selected, highlighted, exact, onSelect, onHover }: {
  cell: TakeoffCellView;
  selected: boolean;
  highlighted: boolean;
  exact: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  const cls = ['tk-cell'];
  if (highlighted) cls.push('tk-hi');
  if (exact) cls.push('tk-hi-exact');
  if (cell.frozen) cls.push('tk-frozen');
  const blocked = cell.items.some((item) => item.tone === 'red' && !item.key.startsWith('adm-pb'));
  const materialCount = cell.items.find((item) => item.key === 'adm-cnt')?.label.match(/\d+/)?.[0];
  const status = cell.completed ? '已办结' : cell.frozen ? '待复核' : blocked ? '有阻断' : cell.needsReview ? '待处理' : cell.running ? '处理中' : materialCount ? `已收到 ${materialCount} 件` : ({ input: '查看材料', analysis: '查看分析', human: '待核验', closure: '待办结' })[cell.row];
  return (
    <button
      type="button"
      className={cls.join(' ')}
      aria-label={cellAriaLabel(cell)}
      aria-selected={selected}
      title={`${cellAriaLabel(cell)}\n依据：${cell.basis}`}
      onClick={onSelect}
      onMouseEnter={onHover}
      onFocus={onHover}
    >
      <svg className="tk-ring" width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        {cell.running && <circle cx={C} cy={C} r={R + 3.5} fill="none" stroke="var(--tk-progress)" strokeWidth="1.6" />}
        {/* 底圆：白底细灰黑边（未完成态；完成后被纯绿整圆覆盖） */}
        <circle cx={C} cy={C} r={R} fill={cell.completed ? 'var(--tk-done)' : 'var(--tk-white)'} stroke={cell.completed ? 'var(--tk-done)' : 'var(--tk-line)'} strokeWidth="1.4" />
        {!cell.completed && cell.displayBucket != null && cell.displayBucket > 0 && (
          <path d={sectorPath(cell.displayBucket as 25 | 50 | 75)} fill="var(--tk-progress)" stroke="none" />
        )}
      </svg>
      <span className="tk-cell-caption">{status}</span>
      {cell.needsReview && <span className={`tk-flag${blocked ? '' : ' caution'}`} aria-hidden="true">!</span>}
      {cell.frozen && <LockGlyph />}
    </button>
  );
}
