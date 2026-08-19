import { useCallback, useEffect, useState } from "react";
import type { ContractGlobalState, ProposalState } from "../lib/contract";
import { fetchAllProposals, fetchGlobalState } from "../lib/contract";

export function useGovernance() {
  const [globalState, setGlobalState] = useState<ContractGlobalState | null>(
    null,
  );
  const [proposals, setProposals] = useState<ProposalState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [state, slots] = await Promise.all([
        fetchGlobalState(),
        fetchAllProposals(),
      ]);
      setGlobalState(state);
      setProposals(slots);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to read contract state",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  return { globalState, proposals, loading, error, refresh };
}
