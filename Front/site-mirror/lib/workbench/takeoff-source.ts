import type { WbClient } from './wb-client';
import type { TakeoffSource } from './takeoff-projection';
export async function readTakeoffSource(client: WbClient, customerId: string, snapshot: TakeoffSource['snapshot']): Promise<TakeoffSource> {
  const next: TakeoffSource = { snapshot: (snapshot ?? null) as unknown as TakeoffSource['snapshot'], packageDetail: null, channelTasks: [], currentMaterials: null, factConflicts: 0, factConflictKeys: [] };
    await Promise.all([
      (async () => {
        try {
          const j = await client.read(`/api/jw/v2/customers/${encodeURIComponent(customerId)}/artifacts`);
          const arts = (Array.isArray(j.artifacts) ? j.artifacts : []) as Array<Record<string, unknown>>;
          next.currentMaterials = arts.filter((a) => a.current === true).length;
          const conflicts = j.factConflicts;
          next.factConflicts = Array.isArray(conflicts) ? conflicts.length : 0;
          // FINAL-02：保存冲突事实键（服务端元素形状 {factKey,assertionCount}），用于把冲突下一步
          // 分派到事实实际所属专业的角色，而不是泛指某岗位。键未知时如实留空，由展示层兜底。
          next.factConflictKeys = Array.isArray(conflicts)
            ? conflicts.map((c) => String((c as { factKey?: unknown })?.factKey ?? '')).filter(Boolean)
            : [];
        } catch (e) {
          // 读取失败如实区分：403=当前身份无权读取（权限不足≠没有材料）；其余=暂时不可读。未知保持 null。
          next.materialsReadError = typeof (e as { status?: unknown })?.status === 'number' ? (e as { status: number }).status : null;
        }
      })(),
      (async () => {
        try {
          const j = await client.channelStatus(customerId);
          next.channelTasks = (Array.isArray(j.tasks) ? j.tasks : []) as Array<{ status?: string }>;
        } catch { /* 通道未接入：任务=空，投影显示不可读 */ }
      })(),
      (async () => {
        try {
          const pkgId = (snapshot?.decisionStatus?.basis?.packageId ?? null) as string | null;
          if (pkgId) next.packageDetail = await client.packageDetail(pkgId) as TakeoffSource['packageDetail'];
        } catch { /* 包详情读取失败：域结果=空 */ }
      })(),
    ]);
  return next;
}
