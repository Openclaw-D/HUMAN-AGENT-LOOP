import type { TakeoffCellView } from '../../lib/workbench/takeoff-projection';
import { takeoffDomainName, takeoffRowName } from '../../lib/workbench/takeoff-projection';
import { cellStatus } from './cell-status';
import { StatusObject } from './status-object';

export function TakeoffCell({ cell, cells, selected, highlighted, exact, onSelect, onHover, readOnly = false }: {
  readOnly?: boolean;
  cell: TakeoffCellView; cells: TakeoffCellView[]; selected: boolean; highlighted: boolean; exact: boolean;
  onSelect: () => void; onHover: () => void;
}) {
  const state = cellStatus(cell, cells);
  const name = `${takeoffDomainName(cell.domain)}，${takeoffRowName(cell.row)}，${state.label}`;
  if (readOnly) return <div className="tk-cell" role="img" aria-label={name} title={name}><span className={`tk-status-icon ${state.color}`} aria-hidden="true"><StatusObject kind={state.icon} animate={false}/></span></div>;
  return <button type="button" className={`tk-cell${highlighted ? ' tk-hi' : ''}${exact ? ' tk-hi-exact' : ''}`}
    aria-label={name} aria-selected={selected} title={name} onClick={onSelect} onMouseEnter={onHover} onFocus={onHover}>
    <span className={`tk-status-icon ${state.color}`} aria-hidden="true"><StatusObject kind={state.icon}/></span>
  </button>;
}
