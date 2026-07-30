import { SolveSuperseded } from "@atelier/sim";
import type { FoldingPlayerState } from "@packcad/fold-solver";
import type { PackagingProject } from "@packcad/format";
import { useEffect, useRef, useState } from "react";
import type {
  CachedFoldSettlement,
  FoldDiagnostics,
} from "./foldSettlement";
import {
  createFoldSettlementWorkerPlugin,
  FoldSettlementClient,
} from "./foldSettlementPlugin";

type ActiveSettlement = {
  model: NonNullable<PackagingProject["foldModel"]>;
  cacheKey: string;
  data: CachedFoldSettlement;
};

export type SharedFoldSettlement = {
  data: CachedFoldSettlement | null;
  diagnostics: FoldDiagnostics;
};

export function useFoldSettlement(
  project: PackagingProject,
  foldPlayback: FoldingPlayerState,
): SharedFoldSettlement {
  const [settlement, setSettlement] = useState<ActiveSettlement | null>(null);
  const [diagnostics, setDiagnostics] = useState<FoldDiagnostics>({
    status: "settling",
  });
  const clientRef = useRef<FoldSettlementClient | null>(null);

  useEffect(() => {
    const client = new FoldSettlementClient(
      createFoldSettlementWorkerPlugin(),
    );
    clientRef.current = client;
    return () => {
      clientRef.current = null;
      client.dispose();
    };
  }, []);

  const model = project.foldModel;
  const foldStepIndex = Math.max(
    0,
    project.foldingSteps.findIndex((step) => step.id === project.activeStepId),
  );
  const activeStep = project.foldingSteps[foldStepIndex];
  const foldAngle = activeStep?.angle ?? 0;
  const cacheKey = `${foldStepIndex}:${foldAngle}`;

  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;
    if (!model) {
      client.cancel();
      setSettlement(null);
      setDiagnostics({
        status: "settled",
        maxEdgeError: 0,
        maxAngleErrorDeg: 0,
        converged: true,
      });
      return;
    }
    if (foldPlayback.positions) {
      client.cancel();
      setSettlement(null);
      setDiagnostics({
        status: "settled",
        maxEdgeError: foldPlayback.solverMaxEdgeError,
        maxAngleErrorDeg: foldPlayback.solverMaxAngleErrorDeg,
        converged: foldPlayback.solverIsSolved,
      });
      return;
    }
    let cancelled = false;
    setSettlement(null);
    setDiagnostics({ status: "settling" });
    void client.solve(model, { foldStepIndex, foldAngle }).then((next) => {
      if (cancelled) return;
      setSettlement({ model, cacheKey, data: next });
      setDiagnostics({
        status: "settled",
        maxEdgeError: next.maxEdgeError,
        maxAngleErrorDeg: next.maxAngleErrorDeg,
        converged: next.converged,
      });
    }).catch((error: unknown) => {
      if (cancelled || error instanceof SolveSuperseded) return;
      setSettlement(null);
      setDiagnostics({
        status: "error",
        message: error instanceof Error
          ? error.message
          : "The settled fold solver failed.",
      });
    });
    return () => {
      cancelled = true;
    };
  }, [
    cacheKey,
    foldAngle,
    foldPlayback.positions,
    foldPlayback.solverIsSolved,
    foldPlayback.solverMaxAngleErrorDeg,
    foldPlayback.solverMaxEdgeError,
    foldStepIndex,
    model,
  ]);

  return {
    data: settlement
      && settlement.model === model
      && settlement.cacheKey === cacheKey
      ? settlement.data
      : null,
    diagnostics,
  };
}
