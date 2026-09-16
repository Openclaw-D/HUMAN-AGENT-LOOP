import { getFixtureSpec, renderFixtureSvg, remoteErrorResponse } from '../../../../../../lib/v5-preview/remote-service.ts';

export async function GET(_request: Request, { params }: { params: Promise<{ fixtureId: string }> }): Promise<Response> {
  try {
    const { fixtureId } = await params;
    const spec = getFixtureSpec(fixtureId);
    const svg = renderFixtureSvg(fixtureId);
    if (spec === undefined || svg === undefined) {
      return new Response(JSON.stringify({ ok: false, error: 'NOT_FOUND', message: '未知 fixtureId（仅允许明确标识的合成测试图形）' }), { status: 404, headers: { 'content-type': 'application/json; charset=utf-8' } });
    }
    return new Response(svg, { status: 200, headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-store' } });
  } catch (error) {
    return remoteErrorResponse(error);
  }
}
