'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type StageId = 'policy' | 'credit' | 'commerce' | 'asset';
type GraphNode = {
  id: string;
  label: string;
  stageId: StageId | 'shared';
  kind: 'context' | 'flow';
  prepState: 'completed' | 'active' | 'locked' | 'shared';
  x: number;
  y: number;
};
type GraphEdge = { id: string; source: string; target: string; label: string; kind: 'shared' | 'sequence' | 'handoff' };
type GraphData = {
  width: number;
  height: number;
  clusters: Array<{ stageId: StageId; label: string; x: number; y: number; width: number; height: number }>;
  nodes: GraphNode[];
  edges: GraphEdge[];
};
type ViewState = { zoom: number; panX: number; panY: number };

const MIN_ZOOM = 0.48;
const MAX_ZOOM = 1.8;

export default function GlobalGraphCanvas({
  caseId,
  contextVersion,
  graph,
  currentFlowId,
  onSelectFlow,
}: {
  caseId: string;
  contextVersion: string;
  graph: GraphData;
  currentFlowId: string;
  onSelectFlow: (flowId: string, stageId: StageId) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const currentFlowIdRef = useRef(currentFlowId);
  const dragRef = useRef<null | { type: 'pan'; pointerId: number; startX: number; startY: number; panX: number; panY: number } | { type: 'node'; pointerId: number; nodeId: string; startX: number; startY: number; x: number; y: number; moved: boolean }>(null);
  const ignoredClickRef = useRef<string | null>(null);
  const [view, setView] = useState<ViewState>({ zoom: 0.78, panX: 0, panY: 0 });
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(() => Object.fromEntries(graph.nodes.map((node) => [node.id, { x: node.x, y: node.y }])));
  const storageKey = `jianwei-graph-layout:${caseId}:${contextVersion}`;

  useEffect(() => {
    currentFlowIdRef.current = currentFlowId;
  }, [currentFlowId]);

  const fitCanvas = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    const zoom = Math.max(MIN_ZOOM, Math.min(1.12, Math.min((rect.width - 52) / graph.width, (rect.height - 52) / graph.height)));
    setView({ zoom, panX: (rect.width - graph.width * zoom) / 2, panY: (rect.height - graph.height * zoom) / 2 });
  }, [graph.height, graph.width]);

  const focusPosition = useCallback((position: { x: number; y: number } | undefined) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height || !position) return;
    const zoom = Math.max(0.82, Math.min(1.12, rect.width / 1020));
    setView({ zoom, panX: rect.width / 2 - position.x * zoom, panY: rect.height / 2 - position.y * zoom });
  }, []);

  const focusCurrent = useCallback(() => {
    focusPosition(positions[currentFlowId]);
  }, [currentFlowId, focusPosition, positions]);

  useEffect(() => {
    const defaults = Object.fromEntries(graph.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
    let nextPositions = defaults;
    try {
      const stored = window.localStorage.getItem(storageKey);
      const parsed = stored ? JSON.parse(stored) as Record<string, { x: number; y: number }> : {};
      nextPositions = Object.fromEntries(graph.nodes.map((node) => {
        const candidate = parsed[node.id];
        return [node.id, candidate && Number.isFinite(candidate.x) && Number.isFinite(candidate.y) ? candidate : defaults[node.id]];
      }));
    } catch { /* use defaults */ }
    const frame = window.requestAnimationFrame(() => {
      setPositions(nextPositions);
      fitCanvas();
      focusPosition(nextPositions[currentFlowIdRef.current]);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fitCanvas, focusPosition, graph.nodes, storageKey]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(focusCurrent);
    return () => window.cancelAnimationFrame(frame);
  }, [currentFlowId]); // eslint-disable-line react-hooks/exhaustive-deps

  const nodeMap = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const point = useCallback((id: string) => positions[id] ?? { x: nodeMap.get(id)?.x ?? 0, y: nodeMap.get(id)?.y ?? 0 }, [nodeMap, positions]);

  const zoomAt = useCallback((clientX: number, clientY: number, targetZoom: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    setView((current) => {
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZoom));
      const pointerX = clientX - rect.left;
      const pointerY = clientY - rect.top;
      const worldX = (pointerX - current.panX) / current.zoom;
      const worldY = (pointerY - current.panY) / current.zoom;
      return { zoom, panX: pointerX - worldX * zoom, panY: pointerY - worldY * zoom };
    });
  }, []);

  const savePositions = useCallback((next: Record<string, { x: number; y: number }>) => {
    try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* local preference can fail silently */ }
  }, [storageKey]);

  return <section className="global-graph" aria-label="政策到资产全域关系图谱" data-testid="global-graph">
    <div className="graph-toolbar">
      <div>
        <strong>全域关系图谱</strong>
        <span>拖动空白平移 · 滚轮按指针缩放 · 拖动节点仅保存个人布局</span>
      </div>
      <div className="graph-actions">
        <button type="button" data-testid="graph-zoom-out" onClick={() => { const rect = viewportRef.current?.getBoundingClientRect(); if (rect) zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, view.zoom - 0.12); }}>−</button>
        <output aria-label="当前图谱缩放比例">{Math.round(view.zoom * 100)}%</output>
        <button type="button" data-testid="graph-zoom-in" onClick={() => { const rect = viewportRef.current?.getBoundingClientRect(); if (rect) zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, view.zoom + 0.12); }}>＋</button>
        <button type="button" data-testid="graph-fit" onClick={fitCanvas}>适应画布</button>
        <button type="button" data-testid="graph-focus" onClick={() => focusCurrent()}>聚焦当前</button>
      </div>
    </div>
    <div
      ref={viewportRef}
      className="graph-viewport"
      data-testid="graph-viewport"
      onWheel={(event) => { event.preventDefault(); zoomAt(event.clientX, event.clientY, view.zoom * (event.deltaY < 0 ? 1.1 : 0.9)); }}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { type: 'pan', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, panX: view.panX, panY: view.panY };
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (drag.type === 'pan') {
          setView((current) => ({ ...current, panX: drag.panX + event.clientX - drag.startX, panY: drag.panY + event.clientY - drag.startY }));
          return;
        }
        const dx = (event.clientX - drag.startX) / view.zoom;
        const dy = (event.clientY - drag.startY) / view.zoom;
        if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
        setPositions((current) => ({ ...current, [drag.nodeId]: { x: Math.max(42, Math.min(graph.width - 42, drag.x + dx)), y: Math.max(42, Math.min(graph.height - 42, drag.y + dy)) } }));
      }}
      onPointerUp={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (drag.type === 'node') {
          if (drag.moved) ignoredClickRef.current = drag.nodeId;
          setPositions((current) => { savePositions(current); return current; });
        }
        dragRef.current = null;
      }}
    >
      <div className="graph-world" style={{ width: graph.width, height: graph.height, transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}>
        {graph.clusters.map((cluster) => <div key={cluster.stageId} className={`graph-cluster stage-${cluster.stageId}`} style={{ left: cluster.x, top: cluster.y, width: cluster.width, height: cluster.height }}><span>{cluster.label}</span></div>)}
        <svg className="graph-lines" width={graph.width} height={graph.height} aria-hidden="true">
          {graph.edges.map((edge) => {
            const source = point(edge.source);
            const target = point(edge.target);
            return <g key={edge.id} className={`graph-edge ${edge.kind}`}>
              <line x1={source.x} y1={source.y} x2={target.x} y2={target.y} />
              <text x={(source.x + target.x) / 2} y={(source.y + target.y) / 2 - 5}>{edge.label}</text>
            </g>;
          })}
        </svg>
        {graph.nodes.map((node) => {
          const position = point(node.id);
          const current = node.id === currentFlowId;
          return <button
            type="button"
            key={node.id}
            className={`global-node ${node.kind} ${node.prepState}${current ? ' current' : ''}`}
            data-node-id={node.id}
            data-prep-state={node.prepState}
            style={{ left: position.x, top: position.y }}
            onPointerDown={(event) => {
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              dragRef.current = { type: 'node', pointerId: event.pointerId, nodeId: node.id, startX: event.clientX, startY: event.clientY, x: position.x, y: position.y, moved: false };
            }}
            onClick={() => {
              if (ignoredClickRef.current === node.id) { ignoredClickRef.current = null; return; }
              if (node.kind === 'flow') onSelectFlow(node.id, node.stageId as StageId);
            }}
          >
            <small>{node.stageId === 'shared' ? 'CANONICAL CONTEXT' : node.stageId}</small>
            <strong>{node.label}</strong>
            <span>{node.prepState === 'completed' ? '候选准备完成' : node.prepState === 'active' ? '当前候选处理' : node.prepState === 'locked' ? '等待前序' : '四路共享'}</span>
          </button>;
        })}
      </div>
    </div>
  </section>;
}
