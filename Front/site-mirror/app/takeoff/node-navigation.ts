import { useEffect, useState } from 'react';
import { TAKEOFF_DOMAINS, TAKEOFF_ROWS, type TakeoffCellView } from '../../lib/workbench/takeoff-projection';
export const nodeId = (cell: TakeoffCellView) => `${cell.domain}:${cell.row}`;
// Stable stage/domain order; include observed work and the first unfinished node in each lane.
export function navigationNodes(cells: TakeoffCellView[]) {
  const included = new Set<string>();
  for (const domain of TAKEOFF_DOMAINS) {
    const lane = TAKEOFF_ROWS.flatMap(row => cells.filter(c => c.domain === domain.id && c.row === row.id));
    const frontier = lane.find(c => !c.completed);
    for (const cell of lane) if (cell.completed || cell.running || cell === frontier) included.add(nodeId(cell));
  }
  return TAKEOFF_ROWS.flatMap(row => TAKEOFF_DOMAINS.flatMap(domain => cells.filter(c => c.row === row.id && c.domain === domain.id && included.has(nodeId(c)))));
}
export const navigationKey = (scope: string) => `jw-node-navigation:v1:${scope}`;
function restore(scope: string) { try { return sessionStorage.getItem(navigationKey(scope)); } catch { return null; } }
export function useNodeNavigation(scope: string, nodes: TakeoffCellView[]) {
  const [position, setPosition] = useState(() => ({ scope, id: restore(scope) }));
  const saved = position.scope === scope ? position.id : restore(scope);
  const index = Math.max(0, nodes.findIndex(c => nodeId(c) === saved));
  const selected = nodes[index] ?? null;
  const id = selected ? nodeId(selected) : null;
  useEffect(() => {
    // Do not erase a stored location while the authorized snapshot is loading.
    if (!id) return;
    setPosition(previous => previous.scope === scope && previous.id === id ? previous : { scope, id });
    try { sessionStorage.setItem(navigationKey(scope), id); } catch { /* Storage unavailable: retain in-memory navigation. */ }
  }, [scope, id]);
  function move(delta: number) {
    setPosition(previous => {
      const current = previous.scope === scope ? previous.id : restore(scope);
      const at = Math.max(0, nodes.findIndex(c => nodeId(c) === current));
      const target = nodes[Math.max(0, Math.min(nodes.length - 1, at + delta))];
      return { scope, id: target ? nodeId(target) : null };
    });
  }
  return { selected, index, move };
}
