import { createV3SharedRuntime } from './shared-runtime.ts';

export * from './shared-runtime.ts';
export * from './sqlite-store.ts';

type RuntimeInstance = ReturnType<typeof createV3SharedRuntime>;

type RuntimeGlobal = typeof globalThis & { __jianweiV3SharedRuntime?: RuntimeInstance };

export function getV3SharedRuntime(): RuntimeInstance {
  const runtimeGlobal = globalThis as RuntimeGlobal;
  runtimeGlobal.__jianweiV3SharedRuntime ??= createV3SharedRuntime();
  return runtimeGlobal.__jianweiV3SharedRuntime;
}
