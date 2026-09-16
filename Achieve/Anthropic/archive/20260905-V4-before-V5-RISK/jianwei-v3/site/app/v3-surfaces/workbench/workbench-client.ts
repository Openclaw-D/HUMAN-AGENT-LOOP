import { createV3ClientSession, v3Api, type V3ApiFetch, type V3DemoSessionDto } from '../../../lib/v3-client.ts';
import type {
  WorkbenchActionRequest,
  WorkbenchActionResult,
  WorkbenchPerspective,
  WorkbenchReadModel,
} from '../../../lib/v3-surfaces/workbench/types.ts';
import type { SurfacePrincipalId } from '../shared/surface-model';

export const WORKBENCH_API_ROUTES = {
  business: { read: '/api/v3/business/cases/FL-DEMO-001/workbench', action: '/api/v3/business/cases/FL-DEMO-001/actions' },
  policy: { read: '/api/v3/policy/cases/FL-DEMO-001/workbench', action: '/api/v3/policy/cases/FL-DEMO-001/actions' },
  credit: { read: '/api/v3/credit/cases/FL-DEMO-001/workbench', action: '/api/v3/credit/cases/FL-DEMO-001/actions' },
  commercial: { read: '/api/v3/commercial/cases/FL-DEMO-001/workbench', action: '/api/v3/commercial/cases/FL-DEMO-001/actions' },
  asset: { read: '/api/v3/asset/cases/FL-DEMO-001/workbench', action: '/api/v3/asset/cases/FL-DEMO-001/actions' },
} as const satisfies Record<WorkbenchPerspective, { read: string; action: string }>;

export async function createWorkbenchSession(principalId: SurfacePrincipalId, signal?: AbortSignal): Promise<V3DemoSessionDto> {
  const payload = await createV3ClientSession(principalId, signal);
  return payload.session;
}

export function readWorkbench(
  perspective: WorkbenchPerspective,
  sessionId: string,
  signal?: AbortSignal,
  fetchImpl?: V3ApiFetch,
): Promise<WorkbenchReadModel> {
  return v3Api<WorkbenchReadModel>(WORKBENCH_API_ROUTES[perspective].read, { sessionId, signal, fetchImpl });
}

export function submitWorkbenchAction(
  perspective: WorkbenchPerspective,
  sessionId: string,
  input: WorkbenchActionRequest,
  fetchImpl?: V3ApiFetch,
): Promise<WorkbenchActionResult> {
  return v3Api<WorkbenchActionResult>(WORKBENCH_API_ROUTES[perspective].action, {
    sessionId, method: 'POST', body: input, fetchImpl,
  });
}
