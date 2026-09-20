import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAssistantModel } from './assistant-model.mjs';
import { digest } from './assistant-receipts.mjs';

/** Registry and configuration paths are server-owned, never accepted by the activation API. */
export async function createAssistantProfiles({ registryPath, stateDir, modelOptions = {} }) {
  if (!stateDir) throw new Error('PROFILE_DURABLE_STATE_REQUIRED');
  const registry = JSON.parse(await fs.readFile(registryPath, 'utf8'));
  if (!Array.isArray(registry.profiles) || !registry.profiles.length) throw new Error('PROFILE_REGISTRY_INVALID');
  const profiles = new Map();
  const key = p => `${p.id}@${p.revision}`;
  for (const p of registry.profiles) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(p.id) || !Number.isSafeInteger(p.revision) || p.revision < 1 || typeof p.configPath !== 'string' || profiles.has(key(p)))
      throw new Error('PROFILE_REGISTRY_INVALID');
    const identity = { id: p.id, revision: p.revision };
    const model = await createAssistantModel({ ...modelOptions, configPath: path.resolve(path.dirname(registryPath), p.configPath), profileIdentity: identity });
    if (!model.configured) throw new Error('PROFILE_NOT_CONFIGURED');
    profiles.set(key(p), { identity, model });
  }
  await fs.mkdir(stateDir, { recursive: true });
  const stateFile = path.join(stateDir, 'active-profile.json');
  let state;
  try { state = JSON.parse(await fs.readFile(stateFile, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; state = { active: registry.active, previous: null }; }
  if (!state.active || !profiles.has(key(state.active))) throw new Error('ACTIVE_PROFILE_INVALID');
  let active = profiles.get(key(state.active));
  let activation = Promise.resolve();
  const pending = new Map();
  const blocked = () => ({ status: 'unknown', sent: null, current: false, replayed: false, observations: [], questions: [], evidenceRefs: [],
    error: { code: 'PROFILE_SEND_UNRESOLVED', messageZh: '既有发送状态未知；切换配置不能解除防重发，请核对回执' } });
  return {
    configured: true,
    get requiresEvidence() { return active.model.requiresEvidence; },
    evidencePolicy: () => active.model.evidencePolicy(),
    status: () => ({ ...active.model.status(), profile: active.identity, previousProfile: state.previous }),
    activate(input, actor) {
      const run = async () => {
        if (!input || Object.keys(input).some(k => !['id', 'revision'].includes(k)) || !profiles.has(key(input))) throw new Error('PROFILE_NOT_REGISTERED');
        const next = profiles.get(key(input));
        if (key(next.identity) === key(active.identity)) return { active: active.identity, previous: state.previous, unchanged: true };
        const nextState = { active: next.identity, previous: active.identity };
        const temp = stateFile + '.' + randomUUID() + '.tmp';
        await fs.writeFile(temp, JSON.stringify(nextState), { flag: 'wx' });
        // Append the attempted transition before mutation; no secrets or model endpoint enter audit.
        await fs.appendFile(path.join(stateDir, 'profile-audit.jsonl'), JSON.stringify({ at: new Date().toISOString(), actor, action: 'activate_requested', ...nextState }) + '\n');
        await fs.rename(temp, stateFile);
        state = nextState; active = next;
        return { ...state, unchanged: false };
      };
      const result = activation.then(run);
      activation = result.catch(() => {});
      return result;
    },
    async observe(input) {
      const chosen = active; // Capture once: activation cannot move an in-flight request.
      const logicalId = digest({ tenantId: input.tenantId, customerId: input.customerId, context: input.context, assistant: input.assistant, question: input.question });
      if (pending.has(logicalId)) return structuredClone(await pending.get(logicalId));
      const execute = async () => {
        const marker = path.join(stateDir, `unresolved-${logicalId}.json`);
        try { await fs.writeFile(marker, JSON.stringify({ profile: chosen.identity }), { flag: 'wx' }); }
        catch { return blocked(); }
        let result;
        try { result = await chosen.model.observe(input); } catch { return blocked(); }
        if (result.status !== 'unknown' && result.sent !== null) {
          try { await fs.unlink(marker); } catch { return { ...result, current: false, error: { code: 'PROFILE_GUARD_IO', messageZh: '回执已保存，防重发标记需核对' } }; }
        }
        return { ...result, profile: chosen.identity };
      };
      const promise = execute(); pending.set(logicalId, promise);
      try { return structuredClone(await promise); } finally { pending.delete(logicalId); }
    },
  };
}
