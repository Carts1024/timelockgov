"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  cancel,
  execute,
  finalize,
  getConfig,
  getLatestLedgerSequence,
  getProposal,
  getProposalCount,
  hasVoted,
  isExecutable,
  propose,
  queue,
  setPaused,
  updateConfig,
  vote,
} from "@/lib/soroban/client";
import { getReadableError } from "@/lib/soroban/errors";
import type { GovernanceOverview, Proposal, VoteSupport } from "@/lib/soroban/types";

interface UseGovernanceState {
  overview: GovernanceOverview | null;
  loading: boolean;
  refreshing: boolean;
  actionInFlight: string | null;
  error: string | null;
  votedMap: Record<number, boolean>;
  executableMap: Record<number, boolean>;
}

const EMPTY_MAP: Record<number, boolean> = {};

export function useGovernance(address: string | null) {
  const [state, setState] = useState<UseGovernanceState>({
    overview: null,
    loading: true,
    refreshing: false,
    actionInFlight: null,
    error: null,
    votedMap: EMPTY_MAP,
    executableMap: EMPTY_MAP,
  });

  const refresh = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      loading: prev.overview === null,
      refreshing: prev.overview !== null,
      error: null,
    }));

    try {
      const [config, proposalCount, latestLedger] = await Promise.all([
        getConfig(),
        getProposalCount(),
        getLatestLedgerSequence(),
      ]);

      const proposalIds = Array.from({ length: proposalCount }, (_, index) => proposalCount - index);

      const proposalResults = await Promise.all(
        proposalIds.map(async (id): Promise<Proposal | null> => {
          try {
            return await getProposal(id);
          } catch {
            return null;
          }
        })
      );

      const proposals = proposalResults.filter((p): p is Proposal => p !== null);

      const votedEntries =
        address === null
          ? []
          : await Promise.all(
              proposals.map(async (proposal) => {
                try {
                  const voted = await hasVoted(proposal.id, address);
                  return [proposal.id, voted] as const;
                } catch {
                  return [proposal.id, false] as const;
                }
              })
            );

      const executableEntries = await Promise.all(
        proposals.map(async (proposal) => {
          if (proposal.status !== 2) {
            return [proposal.id, false] as const;
          }

          try {
            const executable = await isExecutable(proposal.id);
            return [proposal.id, executable] as const;
          } catch {
            return [proposal.id, false] as const;
          }
        })
      );

      setState((prev) => ({
        ...prev,
        overview: {
          config,
          proposalCount,
          latestLedger,
          proposals,
        },
        votedMap: Object.fromEntries(votedEntries),
        executableMap: Object.fromEntries(executableEntries),
        loading: false,
        refreshing: false,
        error: null,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        refreshing: false,
        error: getReadableError(error),
      }));
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const executeAction = useCallback(
    async (action: string, run: () => Promise<void>) => {
      setState((prev) => ({ ...prev, actionInFlight: action, error: null }));

      try {
        await run();
        await refresh();
      } catch (error) {
        setState((prev) => ({
          ...prev,
          error: getReadableError(error),
        }));
      } finally {
        setState((prev) => ({ ...prev, actionInFlight: null }));
      }
    },
    [refresh]
  );

  const actions = useMemo(
    () => ({
      createProposal: async (title: string, description: string) => {
        if (!address) {
          throw new Error("Connect your wallet first.");
        }

        await executeAction("propose", async () => {
          await propose(address, title, description);
        });
      },
      castVote: async (proposalId: number, support: VoteSupport) => {
        if (!address) {
          throw new Error("Connect your wallet first.");
        }

        await executeAction(`vote-${proposalId}`, async () => {
          await vote(address, proposalId, support);
        });
      },
      finalizeProposal: async (proposalId: number) => {
        if (!address) {
          throw new Error("Connect your wallet first.");
        }

        await executeAction(`finalize-${proposalId}`, async () => {
          await finalize(address, proposalId);
        });
      },
      queueProposal: async (proposalId: number) => {
        if (!address) {
          throw new Error("Connect your wallet first.");
        }

        await executeAction(`queue-${proposalId}`, async () => {
          await queue(address, proposalId);
        });
      },
      executeProposal: async (proposalId: number) => {
        if (!address) {
          throw new Error("Connect your wallet first.");
        }

        await executeAction(`execute-${proposalId}`, async () => {
          await execute(address, proposalId);
        });
      },
      cancelProposal: async (proposalId: number) => {
        if (!address) {
          throw new Error("Connect your wallet first.");
        }

        await executeAction(`cancel-${proposalId}`, async () => {
          await cancel(address, proposalId);
        });
      },
      togglePaused: async (paused: boolean) => {
        if (!address) {
          throw new Error("Connect your wallet first.");
        }

        await executeAction("set-paused", async () => {
          await setPaused(address, paused);
        });
      },
      saveConfig: async (payload: {
        timelock_delay: number;
        execution_window: number;
        quorum: number;
        voting_period: number;
      }) => {
        if (!address) {
          throw new Error("Connect your wallet first.");
        }

        await executeAction("update-config", async () => {
          await updateConfig(address, payload);
        });
      },
    }),
    [address, executeAction]
  );

  return {
    ...state,
    refresh,
    actions,
  };
}
