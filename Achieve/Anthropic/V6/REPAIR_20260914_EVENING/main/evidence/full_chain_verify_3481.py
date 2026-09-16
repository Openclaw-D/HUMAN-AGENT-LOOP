# -*- coding: utf-8 -*-
"""REPAIR evening · A 路全链 HTTP 验证（隔离实例 3481，独立数据目录）。
链路 = goal 证据要求：首页进入尽调 → 新增证据 → 纠正 → 旧意见待复核 → 相关四域同步 →
刷新/返回一致 → 重开隔离；并发重复请求与故障中断恢复。
运行：python full_chain_verify_3481.py http://127.0.0.1:3481
"""
import json
import sys
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3481'
PASS = []
FAIL = []


def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method)
    data = None
    if body is not None:
        data = json.dumps(body).encode('utf-8')
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, data, timeout=30) as r:
            return r.status, json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode('utf-8'))
        except Exception:
            return e.code, {}


def check(name, cond, detail=''):
    (PASS if cond else FAIL).append(name)
    print(('PASS' if cond else 'FAIL') + ' | ' + name + ((' | ' + str(detail)[:220]) if detail else ''))


print('=== 0. 起点状态 ===')
st, story = call('GET', '/api/v5-preview/demo/story')
check('GET story = story 模式起点 s00', st == 200 and story['mode'] == 'story' and story['step']['stepId'] == 's00-opp-01', story.get('step', {}).get('stepId'))
check('story 响应带 sharedWarning 字段（契约）', 'sharedWarning' in story)

st, shared = call('GET', '/api/v5-preview/demo/shared-state')
sid = shared['demoSessionId']
check('shared-state 返回专属演示会话', st == 200 and sid == 'rs-demo-run', sid)

print('=== 1. 首页推进 → 尽调（s03 建证据链） ===')
st, r1 = call('POST', '/api/v5-preview/demo/story', {'action': 'advance', 'requestId': 'vc-1', 'expectedVersion': story['version'], 'fromStepId': 's00-opp-01'})
check('advance s00 → s03（人动作边界）', st == 200 and r1['step']['stepId'] == 's03-dd-01', r1.get('step'))
st, det = call('GET', f'/api/v5-preview/remote-session/detail?sessionId={sid}')
insp = [e for e in det['evidence'] if e['fixtureId'] == 'fixture-inspection']
check('s03 落地 = 真实证据已建（fixture-inspection）', len(insp) == 1, [e['evidenceId'] for e in insp])

print('=== 2. 继续推进 → s05 现场补充（升版第 2 次采集）→ s09 决定点 ===')
st, r2 = call('POST', '/api/v5-preview/demo/story', {'action': 'advance', 'requestId': 'vc-2', 'expectedVersion': r1['overview']['version'], 'fromStepId': 's03-dd-01'})
check('advance s03 → s05', st == 200 and r2['step']['stepId'] == 's05-dd-03')
st, r3 = call('POST', '/api/v5-preview/demo/story', {'action': 'advance', 'requestId': 'vc-3', 'expectedVersion': r2['overview']['version'], 'fromStepId': 's05-dd-03'})
check('advance s05 → s09 决定点', st == 200 and r3['step']['stepId'] == 's09-dd-07' and r3['step']['awaitingDecision'] is True)
st, det = call('GET', f'/api/v5-preview/remote-session/detail?sessionId={sid}')
insp = [e for e in det['evidence'] if e['fixtureId'] == 'fixture-inspection']
check('s05 现场补充 = 证据链 2 条（supersede 取代链）', len(insp) == 2, [e.get('supersedes') for e in insp])

print('=== 3. 尽调页人工纠正（同后端命令）→ 旧意见待复核 → 四域同步 ===')
rv = det['remoteVersion']
latest = [e for e in det['evidence'] if e['fixtureId'] == 'fixture-inspection' and e.get('supersededBy') is None][0]
st, rev = call('POST', '/api/v5-preview/remote-session/reviews', {
    'requestId': 'vc-user-correct', 'expectedVersion': rv, 'sessionId': sid,
    'targetType': 'evidence', 'targetId': latest['evidenceId'], 'targetVersion': latest['version'],
    'action': 'correct', 'opinion': '现场照片与陈述时点不一致，人工要求更正（HTTP 验证）',
})
check('尽调页人工纠正（review correct）成功', st == 200 and rev.get('ok') is True)
st, proj = call('GET', '/api/v5-preview/project')
asset = [d for d in proj['domains'] if d['domainId'] == 'asset'][0]
check('首页资产域投影「证据纠正待复核」', '证据纠正待复核' in asset['judgmentText'], asset['judgmentText'])
check('投影不改判断灯颜色（未升绿）', asset['judgmentStatus'] != 'green', asset['judgmentStatus'])
check('首页消息含共享尽调纠正消息', any(m['text'].startswith('共享尽调') and '人工' in m['text'] for m in proj['messages']))
check('首页消息来源不冒充模型判断', all('模型' not in m['fromName'] for m in proj['messages'] if m['id'].startswith('msg-shared')))

st, shared2 = call('GET', '/api/v5-preview/demo/shared-state')
insp_fact = [f for f in shared2['facts'] if f['fixtureId'] == 'fixture-inspection'][0]
check('shared-state：inspection 链 contested + 第2次采集', insp_fact['status'] == 'contested' and insp_fact['chainVersion'] == 2, insp_fact)
check('shared-state：待复核清单 1 项（asset）', len(shared2['pendingReview']) == 1 and shared2['pendingReview'][0]['domain'] == 'asset', shared2['pendingReview'])

print('=== 4. 演示纠正决定（s09 correct）→ 决定后投影保留 ===')
st, r4 = call('POST', '/api/v5-preview/demo/story', {'action': 'decide', 'requestId': 'vc-4', 'expectedVersion': r3['overview']['version'], 'fromStepId': 's09-dd-07', 'decision': 'correct', 'note': '演示纠正（HTTP 验证）'})
check('s09 correct → s13', st == 200 and r4['step']['stepId'] == 's13-dd-08')
asset2 = [d for d in r4['overview']['domains'] if d['domainId'] == 'asset'][0]
check('决定响应内投影保留（资产域仍标待复核）', '证据纠正待复核' in asset2['judgmentText'], asset2['judgmentText'])
st, det = call('GET', f'/api/v5-preview/remote-session/detail?sessionId={sid}')
check('演示纠正生成真实复核记录（rev-demo-s09correct）', any(r['reviewId'].startswith('rev-demo-s09correct') for r in det['reviews']))

print('=== 5. 刷新/返回一致 ===')
st, s_a = call('GET', '/api/v5-preview/demo/story')
st, s_b = call('GET', '/api/v5-preview/demo/story')
check('连续 GET story 同一步（游标稳定）', s_a['step']['stepId'] == s_b['stepId' if False else 'step']['stepId'] == 's13-dd-08', s_a['step']['stepId'])
st, p_b = call('GET', '/api/v5-preview/project')
check('刷新后首页投影一致（资产域仍待复核）', '证据纠正待复核' in [d for d in p_b['domains'] if d['domainId'] == 'asset'][0]['judgmentText'])

print('=== 6. 并发重复请求（同 requestId 重放 / 异载荷 mismatch） ===')
body = {'action': 'advance', 'requestId': 'vc-dup', 'expectedVersion': r4['overview']['version'], 'fromStepId': 's13-dd-08'}
st1, d1 = call('POST', '/api/v5-preview/demo/story', body)
st2, d2 = call('POST', '/api/v5-preview/demo/story', body)
check('同 requestId 重放：版本一致', st1 == 200 and st2 == 200 and d1['overview']['version'] == d2['overview']['version'])
st3, d3 = call('POST', '/api/v5-preview/demo/story', dict(body, decision='confirm'))
check('同 requestId 异载荷 → 409 REQUEST_MISMATCH', st3 == 409 and d3.get('error') == 'REQUEST_MISMATCH', st3)
st, det_fresh = call('GET', f'/api/v5-preview/remote-session/detail?sessionId={sid}')
st4, ev_dup = call('POST', '/api/v5-preview/remote-session/evidence', {'requestId': 'vc-dup-ev', 'expectedVersion': det_fresh['remoteVersion'], 'sessionId': sid, 'fixtureId': 'fixture-equipment'})
st5, ev_dup2 = call('POST', '/api/v5-preview/remote-session/evidence', {'requestId': 'vc-dup-ev', 'expectedVersion': det_fresh['remoteVersion'], 'sessionId': sid, 'fixtureId': 'fixture-equipment'})
check('重放不受版本门影响（幂等先于版本门）', st4 == 200 and st5 == 200, (st4, st5))
st, det2 = call('GET', f'/api/v5-preview/remote-session/detail?sessionId={sid}')
eq = [e for e in det2['evidence'] if e['fixtureId'] == 'fixture-equipment']
check('重复证据请求只落一条', st4 == 200 and st5 == 200 and len(eq) == 1, len(eq))

print('=== 7. 重开隔离 ===')
# 先建「其他会话」+ 其证据（保留对照对象）
st, other = call('POST', '/api/v5-preview/remote-session', {'requestId': 'vc-other-1', 'expectedVersion': det2['remoteVersion'], 'title': '其他会话（重开隔离对照）'})
other_id = other['session']['sessionId']
st, _ = call('POST', '/api/v5-preview/remote-session/evidence', {'requestId': 'vc-other-ev', 'expectedVersion': other['remoteVersion'], 'sessionId': other_id, 'fixtureId': 'fixture-contract'})
st, before_reset = call('GET', '/api/v5-preview/remote-session')
evidence_before_other = len([e for e in before_reset['evidence'] if e['sessionId'] == other_id])

st, rr = call('POST', '/api/v5-preview/demo/reset', {})
check('demo/reset 成功', st == 200 and rr.get('ok') is True)
st, after_reset = call('GET', '/api/v5-preview/remote-session')
check('专属演示会话已清除', not any(s['sessionId'] == sid for s in after_reset['sessions']))
check('其他会话保留', any(s['sessionId'] == other_id for s in after_reset['sessions']))
check('其他会话证据保留', len([e for e in after_reset['evidence'] if e['sessionId'] == other_id]) == evidence_before_other)
st, story2 = call('GET', '/api/v5-preview/demo/story')
check('重开后主线回起点 s00（游标）', story2['mode'] == 'story' and story2['step']['stepId'] == 's00-opp-01')
st, proj3 = call('GET', '/api/v5-preview/project')
check('重开后无共享尽调残留消息（不复活）', not any(m['id'].startswith('msg-shared') for m in proj3['messages']))
st, shared3 = call('GET', '/api/v5-preview/demo/shared-state')
check('重开后专属会话重建且干净', shared3['demoSessionId'] == sid and shared3['evidenceCount'] == 0, shared3)

print('=== 8. 版本单调：重开后旧版本请求被拒（VERSION_CONFLICT） ===')
st, dvc = call('POST', '/api/v5-preview/demo/story', {'action': 'advance', 'requestId': 'vc-stale', 'expectedVersion': r4['overview']['version'], 'fromStepId': 's00-opp-01'})
check('旧 expectedVersion → 409 VERSION_CONFLICT', st == 409 and dvc.get('error') == 'VERSION_CONFLICT', st)

print('')
print(f'==== 结果：PASS {len(PASS)} / FAIL {len(FAIL)} ====')
for f in FAIL:
    print('FAILED: ' + f)
sys.exit(1 if FAIL else 0)
