export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2;

export function clampZoom(value) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(value) || 1));
}

export function layoutNodes(nodes) {
  const positions = {};
  const groups = {
    WorkCase: nodes.filter((node) => node.type === 'WorkCase'),
    HumanPrincipal: nodes.filter((node) => node.type === 'HumanPrincipal'),
    RoutableAgent: nodes.filter((node) => node.type === 'RoutableAgent'),
    ExternalSystem: nodes.filter((node) => node.type === 'ExternalSystem'),
  };
  groups.WorkCase.forEach((node, index) => { positions[node.id] = { x: 600 + index * 40, y: 355 }; });
  groups.HumanPrincipal.forEach((node, index) => { positions[node.id] = { x: 175, y: 205 + index * 205 }; });
  groups.RoutableAgent.forEach((node, index) => { positions[node.id] = { x: 565 + index * 220, y: 115 }; });
  groups.ExternalSystem.forEach((node, index) => { positions[node.id] = { x: 1005, y: 235 + index * 210 }; });
  return positions;
}

export function initialGraphInteraction(nodes) {
  return { zoom: 1, pan: { x: 0, y: 0 }, positions: layoutNodes(nodes), focusedNodeId: nodes[0]?.id ?? null };
}

export function graphInteractionReducer(state, action) {
  switch (action.type) {
    case 'zoom': return { ...state, zoom: clampZoom(action.value) };
    case 'zoomBy': return { ...state, zoom: clampZoom(state.zoom * action.factor) };
    case 'panBy': return { ...state, pan: { x: state.pan.x + action.dx, y: state.pan.y + action.dy } };
    case 'moveNode': return { ...state, positions: { ...state.positions, [action.nodeId]: { x: action.x, y: action.y } } };
    case 'focus': return { ...state, focusedNodeId: action.nodeId };
    case 'fit': return { ...state, zoom: clampZoom(action.zoom), pan: { x: action.x, y: action.y } };
    case 'reset': return { ...initialGraphInteraction(action.nodes), positions: layoutNodes(action.nodes) };
    default: return state;
  }
}

export function fitTransform(positions, viewport = { width: 1200, height: 720 }, padding = 100) {
  const values = Object.values(positions);
  if (values.length === 0) return { zoom: 1, x: 0, y: 0 };
  const minX = Math.min(...values.map((item) => item.x)) - 120;
  const maxX = Math.max(...values.map((item) => item.x)) + 120;
  const minY = Math.min(...values.map((item) => item.y)) - 90;
  const maxY = Math.max(...values.map((item) => item.y)) + 90;
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const zoom = clampZoom(Math.min((viewport.width - padding) / width, (viewport.height - padding) / height));
  return {
    zoom,
    x: (viewport.width - (minX + maxX) * zoom) / 2,
    y: (viewport.height - (minY + maxY) * zoom) / 2,
  };
}

export function nextNodeByDirection(currentId, direction, positions) {
  const current = positions[currentId];
  if (!current) return Object.keys(positions)[0] ?? null;
  const vectors = {
    ArrowLeft: (candidate) => candidate.x < current.x,
    ArrowRight: (candidate) => candidate.x > current.x,
    ArrowUp: (candidate) => candidate.y < current.y,
    ArrowDown: (candidate) => candidate.y > current.y,
  };
  const accepts = vectors[direction];
  if (!accepts) return currentId;
  return Object.entries(positions)
    .filter(([id, candidate]) => id !== currentId && accepts(candidate))
    .sort(([, left], [, right]) => Math.hypot(left.x - current.x, left.y - current.y) - Math.hypot(right.x - current.x, right.y - current.y))[0]?.[0] ?? currentId;
}
