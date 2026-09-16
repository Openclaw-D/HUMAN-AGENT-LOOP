const PROVIDER_LABELS = {
  mock: 'Mock / 未连接真实 GLM',
  'zai-general': 'Z.AI General / 建议层',
};
const STATUS_LABELS = { ready: '就绪', degraded: '降级', unknown: '未知', not_configured: '未配置' };

export function createViewModel(graph, health) {
  if (!graph?.source || !graph?.fiveQuestions || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new TypeError('关系图响应缺少必需字段。');
  const provider = health?.advisoryProvider ?? {};
  return {
    graph,
    questions: Object.values(graph.fiveQuestions),
    provider: {
      status: provider.status ?? 'unknown',
      statusLabel: STATUS_LABELS[provider.status] ?? provider.status ?? '未知',
      label: PROVIDER_LABELS[provider.providerId] ?? `${provider.providerId ?? '未知 provider'} / 建议层`,
      degraded: provider.status === 'degraded',
    },
    connection: health?.status === 'ready' ? '数据已连接' : '数据连接异常',
    stale: graph.source.stale === true,
  };
}

export function visibleUiState(requested, { online = true, hasCases = true, providerDegraded = false, stale = false } = {}) {
  if (!online) return { kind: 'offline', label: '离线：等待重新连接', simulated: false };
  if (requested && requested !== 'normal') {
    const labels = {
      loading: '加载中（界面状态演练）',
      empty: '空状态（界面状态演练）',
      error: '加载错误（界面状态演练）',
      degraded: 'Provider degraded（界面状态演练）',
      versionConflict: '版本冲突（界面状态演练）',
      stale: '视图已过期（界面状态演练）',
    };
    return { kind: requested, label: labels[requested] ?? '正常', simulated: true };
  }
  if (!hasCases) return { kind: 'empty', label: '当前筛选没有 WorkCase', simulated: false };
  if (stale) return { kind: 'stale', label: '视图已过期，需要刷新', simulated: false };
  if (providerDegraded) return { kind: 'degraded', label: 'Provider degraded；核心读取仍可用', simulated: false };
  return { kind: 'ready', label: '已同步', simulated: false };
}

export function advisoryOperation(value) {
  const allowed = new Set(['conflict.identify', 'configuration.suggest', 'action.suggest']);
  if (!allowed.has(value)) throw new TypeError('建议类型不受支持。');
  return value;
}
