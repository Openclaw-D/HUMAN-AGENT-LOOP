export const ActorClass = Object.freeze({ HUMAN: 'human', AGENT: 'agent', CONTROL: 'control' })

export function requireHumanCapability({ actor, membership, capability }) {
  if (actor.class !== ActorClass.HUMAN) throw new Error('HUMAN_AUTHORITY_REQUIRED')
  if (!membership || membership.principalId !== actor.id || membership.status !== 'active') {
    throw new Error('ACTIVE_MEMBERSHIP_REQUIRED')
  }
  if (!membership.capabilities.includes(capability)) throw new Error('CAPABILITY_REQUIRED')
}

export function evaluateDecisionReadiness({ openChallenges, activeRun }) {
  if (activeRun) return { outcome: 'manual_review', reason: 'ACTIVE_RUN' }
  if (openChallenges.some(challenge => challenge.mandatory && challenge.status === 'open')) {
    return { outcome: 'needs_input', reason: 'MANDATORY_CHALLENGE_OPEN' }
  }
  return { outcome: 'ready', reason: 'READY' }
}
