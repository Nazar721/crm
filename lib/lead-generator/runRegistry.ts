interface Registry {
  runs: Map<string, AbortController>;
}

const globalRef = globalThis as unknown as { __lgRunRegistry?: Registry };

const registry: Registry = globalRef.__lgRunRegistry ?? { runs: new Map() };
globalRef.__lgRunRegistry = registry;

export function registerRun(requestId: string, controller: AbortController): void {
  registry.runs.set(requestId, controller);
}

export function unregisterRun(requestId: string): void {
  registry.runs.delete(requestId);
}

export function stopRun(requestId: string): boolean {
  const controller = registry.runs.get(requestId);
  if (!controller) return false;
  controller.abort();
  registry.runs.delete(requestId);
  return true;
}
