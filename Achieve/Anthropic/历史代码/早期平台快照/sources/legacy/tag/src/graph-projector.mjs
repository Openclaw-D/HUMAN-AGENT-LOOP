const nodeId = (type, id) => `${type}:${id}`

export function projectGraph(snapshot) {
  const nodes = []
  const edges = []
  const addNode = (type, item, label = item.title ?? item.statement ?? item.id) => nodes.push({ id: nodeId(type, item.id), type, label })
  const addEdge = (type, fromType, fromId, toType, toId) => edges.push({ id: `${type}:${fromType}:${fromId}:${toType}:${toId}`, type, source: nodeId(fromType, fromId), target: nodeId(toType, toId) })

  addNode('project', snapshot.project)
  for (const thread of snapshot.threads ?? []) {
    addNode('thread', thread)
    addEdge('contains', 'project', snapshot.project.id, 'thread', thread.id)
    for (const message of thread.messages) {
      addNode('message', message, message.content)
      addEdge('contains', 'thread', thread.id, 'message', message.id)
      if (message.replyToMessageId) addEdge('replies_to', 'message', message.id, 'message', message.replyToMessageId)
      for (const citation of message.citations) addEdge('cites', 'message', message.id, 'evidence', citation.evidenceId ?? citation)
    }
  }
  for (const evidence of snapshot.evidence ?? []) {
    addNode('evidence', evidence)
    addEdge('owns', 'project', snapshot.project.id, 'evidence', evidence.id)
  }
  for (const goal of snapshot.goals ?? []) {
    addNode('goal', goal)
    addEdge('pursues', 'project', snapshot.project.id, 'goal', goal.id)
    if (goal.supersedesGoalId) addEdge('supersedes', 'goal', goal.id, 'goal', goal.supersedesGoalId)
  }
  for (const run of snapshot.runs ?? []) {
    addNode('run', run)
    addEdge('executes_in', 'run', run.id, 'thread', run.threadId)
  }
  for (const run of snapshot.advisoryRuns ?? []) {
    addNode('advisory_run', run)
    addEdge('executes_in', 'advisory_run', run.id, 'thread', run.threadId)
    addEdge('uses_snapshot', 'advisory_run', run.id, 'snapshot', run.snapshotId)
    if (run.reviewRoundId) addEdge('for_review', 'advisory_run', run.id, 'review_round', run.reviewRoundId)
    if (run.precheckAttemptId) addEdge('for_precheck', 'advisory_run', run.id, 'precheck_attempt', run.precheckAttemptId)
    if (run.artifactId) addEdge('produces', 'advisory_run', run.id, 'artifact', run.artifactId)
  }
  for (const decision of snapshot.decisions ?? []) {
    addNode('decision', decision, decision.outcome)
    addEdge('decides', 'decision', decision.id, 'thread', decision.threadId)
  }
  for (const round of snapshot.reviewRounds ?? []) {
    addNode('review_round', round)
    addEdge('reviews', 'review_round', round.id, 'thread', round.threadId)
    if (round.snapshotId) addEdge('uses_snapshot', 'review_round', round.id, 'snapshot', round.snapshotId)
    if (round.decisionId) addEdge('has_decision', 'review_round', round.id, 'decision', round.decisionId)
  }
  for (const snapshotRecord of snapshot.snapshots ?? []) {
    addNode('snapshot', snapshotRecord)
    addEdge('captures', 'snapshot', snapshotRecord.id, 'thread', snapshotRecord.threadId)
    if (snapshotRecord.reviewRoundId) addEdge('for_review', 'snapshot', snapshotRecord.id, 'review_round', snapshotRecord.reviewRoundId)
    for (const evidenceRef of snapshotRecord.evidence ?? []) addEdge('includes_evidence', 'snapshot', snapshotRecord.id, 'evidence', evidenceRef.evidenceId)
  }
  for (const challenge of snapshot.challenges ?? []) {
    addNode('challenge', challenge, challenge.prompt)
    addEdge('challenges', 'challenge', challenge.id, 'review_round', challenge.reviewRoundId)
    addEdge('from_snapshot', 'challenge', challenge.id, 'snapshot', challenge.snapshotId)
  }
  for (const artifact of snapshot.artifacts ?? []) {
    addNode('artifact', artifact)
    if (artifact.reviewRoundId) addEdge('advises', 'artifact', artifact.id, 'review_round', artifact.reviewRoundId)
    if (artifact.precheckAttemptId) addEdge('advises_precheck', 'artifact', artifact.id, 'precheck_attempt', artifact.precheckAttemptId)
    addEdge('based_on_snapshot', 'artifact', artifact.id, 'snapshot', artifact.snapshotId)
    for (const citation of artifact.citations ?? []) addEdge('cites', 'artifact', artifact.id, 'evidence', citation.evidenceId)
  }
  for (const attempt of snapshot.precheckAttempts ?? []) { addNode('precheck_attempt', attempt); addEdge('prechecks', 'precheck_attempt', attempt.id, 'thread', attempt.threadId); addEdge('uses_snapshot', 'precheck_attempt', attempt.id, 'snapshot', attempt.snapshotId) }
  for (const pass of snapshot.reviewPasses ?? []) { addNode('review_pass', pass); addEdge('reviews', 'review_pass', pass.id, 'review_round', pass.reviewRoundId); addEdge('uses_snapshot', 'review_pass', pass.id, 'snapshot', pass.snapshotId) }

  return { projectId: snapshot.project.id, nodes, edges, layout: null }
}
