import {
  handleWorkbenchAction,
  workbenchMethodNotAllowed,
} from '@/lib/v3-surfaces/workbench/http.ts';

type Params = { params: Promise<{ caseId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { caseId } = await params;
  return handleWorkbenchAction(request, caseId, 'asset');
}

export const GET = workbenchMethodNotAllowed;
export const DELETE = workbenchMethodNotAllowed;
export const PATCH = workbenchMethodNotAllowed;
export const PUT = workbenchMethodNotAllowed;
export const HEAD = workbenchMethodNotAllowed;
export const OPTIONS = workbenchMethodNotAllowed;
