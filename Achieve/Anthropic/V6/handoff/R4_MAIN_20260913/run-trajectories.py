#!/usr/bin/env python3
# R4 · 三条真实运行轨迹执行器（HTTP 直调 3321 隔离实例；全部合成演示，真实发生再记录）
# v2：requestId 带 RUNTAG 每轮唯一；pause 前从 /detail 读标注当前版本（F3 版本门：回复会推进标注版本，
#     用旧版本 pause 被拒是产品正确行为，不是缺陷）。
import json, urllib.request, urllib.error, time

B = 'http://localhost:3321/api/v5-preview/remote-session'
RUNTAG = 'r' + str(int(time.time()))
def RID(b):
    return b + '-' + RUNTAG

def get(path=''):
    return json.loads(urllib.request.urlopen(B + '/' + path).read())
def DET(sid):
    return get('detail?sessionId=' + sid)
def post(path, body):
    req = urllib.request.Request((B + '/' + path) if path else B, data=json.dumps(body, ensure_ascii=False).encode('utf-8'), headers={'content-type': 'application/json'}, method='POST')
    try:
        return json.loads(urllib.request.urlopen(req).read())
    except urllib.error.HTTPError as e:
        try: eb = json.loads(e.read().decode('utf-8', 'ignore'))
        except Exception: eb = {}
        return {'ok': False, 'error': eb.get('error', e.code), 'status': e.code, '_body': str(eb.get('message', ''))[:150]}
def V():
    return get('')['remoteVersion']
def annVer(sid, annId):
    for a in DET(sid)['annotations']:
        if a['annotationId'] == annId:
            return a['version']
    return None
def must(r, label):
    assert r.get('ok'), f'{label} 失败: {json.dumps({k: r[k] for k in r if k != "_body"}, ensure_ascii=False)} {r.get("_body","")}'

out = {'runTag': RUNTAG, 'base': B, 'trajectories': {}}

def new_session(title, rid):
    r = post('', {'requestId': rid, 'expectedVersion': V(), 'title': title})
    must(r, 'create')
    return r['session']['sessionId'], r['remoteVersion']

# ===== 轨迹1：正常访谈（提问→业务回复→人工确认→挂断暂停→显式恢复接续）=====
t1 = {}
sid, v = new_session('R4轨迹1：正常访谈（合成）', RID('r4a-create'))
r = post('evidence', {'requestId': RID('r4a-ev'), 'expectedVersion': v, 'sessionId': sid, 'fixtureId': 'fixture-inspection'})
must(r, 't1-attach'); ev, v = r['evidence']['evidenceId'], r['remoteVersion']
r = post('annotations', {'requestId': RID('r4a-ann'), 'expectedVersion': v, 'sessionId': sid, 'evidenceId': ev, 'evidenceVersion': 1, 'question': '轨迹1：请说明设备现状（合成）', 'rect': {'x': 0.1, 'y': 0.1, 'w': 0.3, 'h': 0.3}})
must(r, 't1-annotate'); v = r['remoteVersion']; ann = r['annotation']['annotationId']
r = post('annotations/replies', {'requestId': RID('r4a-reply'), 'expectedVersion': v, 'sessionId': sid, 'annotationId': ann, 'kind': 'business', 'text': '轨迹1：三台运行正常（合成）'})
must(r, 't1-reply'); v = r['remoteVersion']
av = annVer(sid, ann)  # 回复已推进标注版本 → pause 用当前版本（旧版被拒属 F3 版本门正确行为）
# 预建第二问标注：暂停中的人工补证落在此条（补证不受限语义不变），保证 pause/resume 引用的
# ann1 终值版本不再演进（C 回放器 R-VER 只见标注终值——代际历史盲区的编排对齐，见报告）。
r = post('annotations', {'requestId': RID('r4a-ann2pre'), 'expectedVersion': v, 'sessionId': sid, 'evidenceId': ev, 'evidenceVersion': 1, 'question': '轨迹1第二问：恢复后接续追问（合成）', 'rect': {'x': 0.4, 'y': 0.4, 'w': 0.3, 'h': 0.2}})
must(r, 't1-ann2pre'); ann2 = r['annotation']['annotationId']
r = post('reviews', {'requestId': RID('r4a-confirm'), 'expectedVersion': DET(sid)['remoteVersion'], 'sessionId': sid, 'targetType': 'evidence', 'targetId': ev, 'targetVersion': 1, 'action': 'confirm', 'opinion': '轨迹1：人工确认（合成）'})
must(r, 't1-confirm'); v = r['remoteVersion']
r = post('reviews', {'requestId': RID('r4a-pause'), 'expectedVersion': v, 'sessionId': sid, 'targetType': 'annotation', 'targetId': ann, 'targetVersion': av, 'action': 'pause_round', 'opinion': '轨迹1：访谈结束挂断暂停（合成）'})
must(r, 't1-pause'); v = r['remoteVersion']
t1.update(session=sid, annotation=ann, paused=True, pauseTargetAnnotationVersion=av, endV=v)
# 暂停中三类探针（F2 语义：模型推进与确认通过类被阻断；人工补证不受限）：
pa = DET(sid)['remoteVersion']
r = post('annotations/simulate', {'requestId': RID('r4a-blk-fu'), 'expectedVersion': pa, 'sessionId': sid, 'annotationId': ann})
t1['pausedModelFollowUpRejected'] = (not r.get('ok')) and r.get('error') == 'SESSION_PAUSED'
r = post('reviews', {'requestId': RID('r4a-blk-confirm'), 'expectedVersion': DET(sid)['remoteVersion'], 'sessionId': sid, 'targetType': 'evidence', 'targetId': ev, 'targetVersion': 1, 'action': 'confirm', 'opinion': '轨迹1：暂停中确认（应被拒）'})
t1['pausedConfirmRejected'] = (not r.get('ok')) and r.get('error') == 'SESSION_PAUSED'
r = post('annotations/replies', {'requestId': RID('r4a-blk-reply'), 'expectedVersion': DET(sid)['remoteVersion'], 'sessionId': sid, 'annotationId': ann2, 'kind': 'business', 'text': '轨迹1：暂停中人工补证（设计允许）'})
t1['pausedHumanReplyAllowed'] = bool(r.get('ok'))
# 显式恢复后：模型推进与确认通过类解除阻断；恢复后的接续活动全部落在第二条标注（ann2）——
# ann1 终值版本与 resume 引用保持一致（C 回放器 R-VER 只见标注终值、原地演进历史不可见，
# 对齐编排：被复核标注在 resume 后不再演进；代际历史盲区的产品侧观测提议另见报告）。
r = post('reviews', {'requestId': RID('r4a-resume'), 'expectedVersion': DET(sid)['remoteVersion'], 'sessionId': sid, 'targetType': 'annotation', 'targetId': ann, 'targetVersion': annVer(sid, ann), 'action': 'resume_round', 'opinion': '轨迹1：显式恢复（合成）'})
must(r, 't1-resume')
r = post('annotations/simulate', {'requestId': RID('r4a-fu2'), 'expectedVersion': DET(sid)['remoteVersion'], 'sessionId': sid, 'annotationId': ann2})
t1['resumedFollowUpOk'] = bool(r.get('ok')); t1['resumedFollowUpStatus'] = (r.get('result') or {}).get('status')
must(r, 't1-followup-ann2')
r = post('annotations/replies', {'requestId': RID('r4a-after'), 'expectedVersion': DET(sid)['remoteVersion'], 'sessionId': sid, 'annotationId': ann2, 'kind': 'business', 'text': '轨迹1：恢复后人工接续（合成）'})
must(r, 't1-after-resume')
t1.update(resumed=True, resumeWriteOk=True, ann1FinalVer=annVer(sid, ann), endV=r['remoteVersion'])
out['trajectories']['t1_normal'] = t1

# ===== 轨迹2：迟到旧版被拒→同ID新版本重试成功→版本推进后再迟到→重试成功 =====
t2 = {}
sid2, v2 = new_session('R4轨迹2：迟到与重试（合成）', RID('r4b-create'))
r = post('evidence', {'requestId': RID('r4b-ev'), 'expectedVersion': v2, 'sessionId': sid2, 'fixtureId': 'fixture-equipment'})
must(r, 't2-attach'); ev2, v2 = r['evidence']['evidenceId'], r['remoteVersion']
body = {'requestId': RID('r4b-ann'), 'sessionId': sid2, 'evidenceId': ev2, 'evidenceVersion': 1, 'question': '轨迹2问题（合成）', 'rect': {'x': 0.2, 'y': 0.2, 'w': 0.2, 'h': 0.2}}
stale = post('annotations', {**body, 'expectedVersion': v2 - 1})  # 迟到：旧 expectedVersion
t2['staleRejected'] = (not stale.get('ok')) and stale.get('error') == 'VERSION_CONFLICT'
t2['staleError'] = stale.get('error')
retry = post('annotations', {**body, 'expectedVersion': DET(sid2)['remoteVersion']})  # 同ID新版本重试
must(retry, 't2-retry'); v2 = retry['remoteVersion']; ann2 = retry['annotation']['annotationId']
t2.update(retrySameIdOk=True, annId=ann2)
# 版本推进（另开一条标注）后再用旧 expectedVersion 复测迟到
r = post('annotations', {'requestId': RID('r4b-ann2'), 'expectedVersion': v2, 'sessionId': sid2, 'evidenceId': ev2, 'evidenceVersion': 1, 'question': '轨迹2第二问（合成）', 'rect': {'x': 0.5, 'y': 0.5, 'w': 0.2, 'h': 0.2}})
must(r, 't2-ann2'); v2 = r['remoteVersion']
stale2 = post('annotations/replies', {'requestId': RID('r4b-stale-reply'), 'expectedVersion': v2 - 1, 'sessionId': sid2, 'annotationId': ann2, 'kind': 'business', 'text': '轨迹2迟到回复（应被拒）'})
t2['lateReplyRejected'] = (not stale2.get('ok')) and stale2.get('error') == 'VERSION_CONFLICT'
r = post('annotations/replies', {'requestId': RID('r4b-stale-reply'), 'expectedVersion': DET(sid2)['remoteVersion'], 'sessionId': sid2, 'annotationId': ann2, 'kind': 'business', 'text': '轨迹2同ID重试回复（合成）'})
must(r, 't2-retry-reply'); t2['retryReplyOk'] = True
# 暂停→暂停中模型推进被拒→显式恢复（挂断语义与轨迹1互补；恢复后无写入，ann2 终值=resume 引用）
r = post('reviews', {'requestId': RID('r4b-pause'), 'expectedVersion': DET(sid2)['remoteVersion'], 'sessionId': sid2, 'targetType': 'annotation', 'targetId': ann2, 'targetVersion': annVer(sid2, ann2), 'action': 'pause_round', 'opinion': '轨迹2：挂断暂停（合成）'})
must(r, 't2-pause')
r = post('annotations/simulate', {'requestId': RID('r4b-blk-fu'), 'expectedVersion': DET(sid2)['remoteVersion'], 'sessionId': sid2, 'annotationId': ann2})
t2['pausedModelFollowUpRejected'] = (not r.get('ok')) and r.get('error') == 'SESSION_PAUSED'
r = post('reviews', {'requestId': RID('r4b-resume'), 'expectedVersion': DET(sid2)['remoteVersion'], 'sessionId': sid2, 'targetType': 'annotation', 'targetId': ann2, 'targetVersion': annVer(sid2, ann2), 'action': 'resume_round', 'opinion': '轨迹2：显式恢复（合成）'})
must(r, 't2-resume')
t2['endV'] = DET(sid2)['remoteVersion']
out['trajectories']['t2_late_retry'] = t2

# ===== 轨迹3：分歧并存（业务 vs 信审不同结论）→ 人工确认 → 人工纠偏 =====
t3 = {}
sid3, v3 = new_session('R4轨迹3：分歧并存（合成）', RID('r4c-create'))
r = post('evidence', {'requestId': RID('r4c-ev'), 'expectedVersion': v3, 'sessionId': sid3, 'fixtureId': 'fixture-contract'})
must(r, 't3-attach'); ev3, v3 = r['evidence']['evidenceId'], r['remoteVersion']
r = post('annotations', {'requestId': RID('r4c-ann'), 'expectedVersion': v3, 'sessionId': sid3, 'evidenceId': ev3, 'evidenceVersion': 1, 'question': '轨迹3：合同要素核对（合成）', 'rect': {'x': 0.1, 'y': 0.1, 'w': 0.4, 'h': 0.3}})
must(r, 't3-annotate'); v3 = r['remoteVersion']; ann3 = r['annotation']['annotationId']
r1 = post('annotations/replies', {'requestId': RID('r4c-r1'), 'expectedVersion': v3, 'sessionId': sid3, 'annotationId': ann3, 'kind': 'business', 'text': '业务意见：条款无误（合成）'})
must(r1, 't3-r1'); v3 = r1['remoteVersion']
r2 = post('annotations/replies', {'requestId': RID('r4c-r2'), 'expectedVersion': v3, 'sessionId': sid3, 'annotationId': ann3, 'kind': 'domain', 'text': '信审不同结论：付款节点需复核（合成）'})
must(r2, 't3-r2'); v3 = r2['remoteVersion']
rc = post('reviews', {'requestId': RID('r4c-confirm'), 'expectedVersion': v3, 'sessionId': sid3, 'targetType': 'evidence', 'targetId': ev3, 'targetVersion': 1, 'action': 'confirm', 'opinion': '轨迹3：业务侧确认（合成）'})
t3['confirmOk'] = bool(rc.get('ok')); t3['confirmError'] = rc.get('error')
if rc.get('ok'): v3 = rc['remoteVersion']
rr = post('reviews', {'requestId': RID('r4c-correct'), 'expectedVersion': DET(sid3)['remoteVersion'], 'sessionId': sid3, 'targetType': 'evidence', 'targetId': ev3, 'targetVersion': 1, 'action': 'correct', 'opinion': '轨迹3：纠正——付款节点实为季度（合成）', 'before': '付款节点为月度（合成）', 'after': '付款节点为季度（合成）'})
t3['correctOk'] = bool(rr.get('ok')); t3['correctError'] = rr.get('error')
if rr.get('ok'): v3 = rr['remoteVersion']
t3.update(session=sid3, annotation=ann3, endV=v3)
out['trajectories']['t3_dissent'] = t3

json.dump(out, open('r4-trajectory-run.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(json.dumps(out, ensure_ascii=False))
