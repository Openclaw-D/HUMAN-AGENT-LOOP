import type { WbClient } from './wb-client';
import type { TakeoffSource } from './takeoff-projection';
export async function readTakeoffSource(client: WbClient, customerId: string, snapshot: TakeoffSource['snapshot']): Promise<TakeoffSource> {
  const next: TakeoffSource = { snapshot: (snapshot ?? null) as unknown as TakeoffSource['snapshot'], packageDetail: null, channelTasks: [], currentMaterials: null, factConflicts: 0 };
    await Promise.all([
      (async () => {
        try {
          const j = await client.read(`/api/jw/v2/customers/${encodeURIComponent(customerId)}/artifacts`);
          const arts = (Array.isArray(j.artifacts) ? j.artifacts : []) as Array<Record<string, unknown>>;
          next.currentMaterials = arts.filter((a) => a.current === true).length;
          const conflicts = j.factConflicts;
          next.factConflicts = Array.isArray(conflicts) ? conflicts.length : 0;
        } catch { /* 未知保持 null */ }
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
