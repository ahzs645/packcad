import {
  createSolveHost,
  createWorkerSteadySolverPlugin,
  SolveSuperseded,
  type SolveHost,
  type SteadySolverPlugin,
} from "@atelier/sim";
import type { FoldModel } from "@packcad/format";
import type {
  CachedFoldSettlement,
  FoldSettlementRequest,
} from "./foldSettlement";

export const FOLD_SETTLEMENT_DEBOUNCE_MS = 180;

export type FoldSettlementPlugin = SteadySolverPlugin<
  FoldModel,
  FoldSettlementRequest,
  CachedFoldSettlement
>;

export function createFoldSettlementWorkerPlugin(): FoldSettlementPlugin {
  return createWorkerSteadySolverPlugin({
    id: "packcad.fold-settlement",
    createWorker: () => new Worker(
      new URL("./foldSettleWorker.ts", import.meta.url),
      { type: "module" },
    ),
    cancelMode: "terminate",
    mapError: (message) => new Error(
      message || "The settled fold solver failed.",
    ),
  });
}

/**
 * A model-aware solve client. Each FoldModel receives its own host (and LRU
 * cache), while the active AbortController keeps latest-request-wins global
 * when the model itself changes.
 */
export class FoldSettlementClient {
  readonly #plugin: FoldSettlementPlugin;
  readonly #hosts = new WeakMap<
    FoldModel,
    Promise<SolveHost<FoldSettlementRequest, CachedFoldSettlement>>
  >();
  readonly #ownedHosts = new Set<
    Promise<SolveHost<FoldSettlementRequest, CachedFoldSettlement>>
  >();
  #active: AbortController | null = null;
  #disposed = false;

  constructor(plugin: FoldSettlementPlugin) {
    this.#plugin = plugin;
  }

  async solve(
    model: FoldModel,
    query: FoldSettlementRequest,
  ): Promise<CachedFoldSettlement> {
    if (this.#disposed) throw new Error("Fold settlement client disposed");
    this.cancel();
    const controller = new AbortController();
    this.#active = controller;
    const host = await this.hostFor(model);
    if (controller.signal.aborted) {
      throw controller.signal.reason ?? new SolveSuperseded();
    }
    try {
      return await host.solve(query, { signal: controller.signal });
    } finally {
      if (this.#active === controller) this.#active = null;
    }
  }

  cancel(): void {
    if (!this.#active) return;
    this.#active.abort(new SolveSuperseded());
    this.#active = null;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.cancel();
    for (const host of this.#ownedHosts) {
      void host.then((prepared) => prepared.dispose()).catch(() => {
        // A host that failed during preparation has nothing to dispose.
      });
    }
    this.#ownedHosts.clear();
  }

  private hostFor(
    model: FoldModel,
  ): Promise<SolveHost<FoldSettlementRequest, CachedFoldSettlement>> {
    const existing = this.#hosts.get(model);
    if (existing) return existing;
    const host = createSolveHost(this.#plugin, {
      input: model,
      debounceMs: FOLD_SETTLEMENT_DEBOUNCE_MS,
      cacheKey: ({ foldStepIndex, foldAngle }) =>
        `${foldStepIndex}:${foldAngle}`,
      maxCacheEntries: Number.POSITIVE_INFINITY,
    });
    this.#hosts.set(model, host);
    this.#ownedHosts.add(host);
    return host;
  }
}
