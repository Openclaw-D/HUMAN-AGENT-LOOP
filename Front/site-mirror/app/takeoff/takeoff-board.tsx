// TAKEOFF-FA-1.0.0 · 二十格看板（02_FRONTEND_SPEC §1/§3/§4）：
// 横向五列固定（商机/政策/信审/商务/资产）×纵向四行固定（输入/智能/人工/完成），
// 行列标题只放两字与小图标。悬浮/键盘聚焦同行同列淡黄交叉高亮、交点边框略深；
// 点击打开真实事项（不手工改状态）。资产列与信审并列，无"商务先行"锁。
import { useState } from 'react';
import type { TakeoffCellView, TakeoffDomainId, TakeoffRowId } from '../../lib/workbench/takeoff-projection';
import { TAKEOFF_DOMAINS, TAKEOFF_ROWS } from '../../lib/workbench/takeoff-projection';
import { TakeoffCell } from './takeoff-cell';

// 图标只用黑灰小字形（不用 emoji 彩色；01 §7 限定色系）
const DOMAIN_GLYPH: Record<TakeoffDomainId, string> = {
  opportunity: '▣', policy: '☰', credit: '⋂', commerce: '∮', asset: '◈',
};
const ROW_GLYPH: Record<TakeoffRowId, string> = { input: '⇥', analysis: '⚙', human: '✋', closure: '◉' };

export function TakeoffBoard({ cells, selected, onSelect }: {
  cells: TakeoffCellView[];
  selected: { domain: TakeoffDomainId; row: TakeoffRowId } | null;
  onSelect: (c: TakeoffCellView) => void;
}) {
  const [hover, setHover] = useState<{ domain: TakeoffDomainId; row: TakeoffRowId } | null>(null);
  const byKey = new Map(cells.map((c) => [`${c.domain}:${c.row}`, c]));
  return (
    <div className="tk-board-wrap" onMouseLeave={() => setHover(null)}>
      <div className="tk-board" role="grid" aria-label="二十格看板（五域×输入/智能/人工/完成；点格查看真实事项，不做手工状态切换）">
        <div className="tk-corner" aria-hidden="true">域×行</div>
        {TAKEOFF_DOMAINS.map((d) => (
          <div
            key={d.id}
            role="columnheader"
            className={`tk-hcell${hover?.domain === d.id ? ' tk-hi' : ''}`}
          >
            <span className="tk-ico" aria-hidden="true">{DOMAIN_GLYPH[d.id]}</span>
            {d.name}
          </div>
        ))}
        {TAKEOFF_ROWS.map((r) => (
          <RowCells
            key={r.id}
            row={r}
            hover={hover}
            selected={selected}
            byKey={byKey}
            onSelect={onSelect}
            onHover={setHover}
          />
        ))}
      </div>
    </div>
  );
}

function RowCells({ row, hover, selected, byKey, onSelect, onHover }: {
  row: (typeof TAKEOFF_ROWS)[number];
  hover: { domain: TakeoffDomainId; row: TakeoffRowId } | null;
  selected: { domain: TakeoffDomainId; row: TakeoffRowId } | null;
  byKey: Map<string, TakeoffCellView>;
  onSelect: (c: TakeoffCellView) => void;
  onHover: (h: { domain: TakeoffDomainId; row: TakeoffRowId }) => void;
}) {
  return (
    <>
      <div role="rowheader" className={`tk-hcell rowh${hover?.row === row.id ? ' tk-hi' : ''}`}>
        <span className="tk-ico" aria-hidden="true">{ROW_GLYPH[row.id]}</span>
        {row.name}
      </div>
      {TAKEOFF_DOMAINS.map((d) => {
        const cell = byKey.get(`${d.id}:${row.id}`);
        if (!cell) return <div key={d.id} className="tk-cell" aria-hidden="true" />;
        const inHoverRowCol = hover !== null && (hover.row === row.id || hover.domain === d.id);
        const exact = hover !== null && hover.row === row.id && hover.domain === d.id;
        const isSelected = selected?.domain === d.id && selected?.row === row.id;
        return (
          <TakeoffCell
            key={`${d.id}:${row.id}`}
            cell={cell}
            selected={isSelected}
            highlighted={inHoverRowCol}
            exact={exact}
            onSelect={() => onSelect(cell)}
            onHover={() => onHover({ domain: d.id, row: row.id })}
          />
        );
      })}
    </>
  );
}
