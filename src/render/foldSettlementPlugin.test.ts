import {
  SolveSuperseded,
  type SteadySolverPlugin,
} from "@atelier/sim";
import { createMailerBoxProject } from "@packcad/fold-solver";
import type { FoldModel } from "@packcad/format";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CachedFoldSettlement,
  FoldSettlementRequest,
} from "./foldSettlement";
import { FoldSettlementClient } from "./foldSettlementPlugin";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve: Deferred<T>["resolve"] = () => undefined;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

type SolveCall = {
  model: FoldModel;
  query: FoldSettlementRequest;
  result: Deferred<CachedFoldSettlement>;
};

function fakePlugin(calls: SolveCall[]): SteadySolverPlugin<
  FoldModel,
  FoldSettlementRequest,
  CachedFoldSettlement
> {
  return {
    id: "fake.fold-settlement",
    backend: "cpu",
    prepare: async (model) => ({
      solve: (query) => {
        const result = deferred<CachedFoldSettlement>();
        calls.push({ model, query, result });
        return result.promise;
      },
      dispose: () => undefined,
    }),
  };
}

function result(edgeError: number): CachedFoldSettlement {
  return {
    positions: [[edgeError, 0, 0]],
    maxEdgeError: edgeError,
    maxAngleErrorDeg: 0,
    converged: true,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("FoldSettlementClient solve-host policy", () => {
  it("debounces for 180ms, supersedes older work, and caches by model/step/angle", async () => {
    vi.useFakeTimers();
    const calls: SolveCall[] = [];
    const client = new FoldSettlementClient(fakePlugin(calls));
    const model = createMailerBoxProject().foldModel;
    if (!model) throw new Error("Mailer Box has no fold model");

    const first = client.solve(model, { foldStepIndex: 1, foldAngle: 20 });
    await vi.advanceTimersByTimeAsync(100);
    const latest = client.solve(model, { foldStepIndex: 2, foldAngle: 40 });
    await expect(first).rejects.toBeInstanceOf(SolveSuperseded);
    await vi.advanceTimersByTimeAsync(179);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toEqual({ foldStepIndex: 2, foldAngle: 40 });
    calls[0]?.result.resolve(result(0.04));
    await expect(latest).resolves.toEqual(result(0.04));

    await expect(
      client.solve(model, { foldStepIndex: 2, foldAngle: 40 }),
    ).resolves.toEqual(result(0.04));
    expect(calls).toHaveLength(1);

    const otherModel = { ...model };
    const other = client.solve(otherModel, {
      foldStepIndex: 2,
      foldAngle: 40,
    });
    await vi.advanceTimersByTimeAsync(180);
    expect(calls).toHaveLength(2);
    calls[1]?.result.resolve(result(0.08));
    await expect(other).resolves.toEqual(result(0.08));

    client.dispose();
  });
});
