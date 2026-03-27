"use client";

import { FormEvent, useMemo, useState } from "react";
import { z } from "zod";

import { useGovernance } from "@/hooks/use-governance";
import { useWallet } from "@/hooks/use-wallet";
import { decodeBytesToText } from "@/lib/soroban/codec";
import { PROPOSAL_STATUS_LABEL, ProposalStatus, type Proposal } from "@/lib/soroban/types";

const proposalSchema = z.object({
  title: z.string().trim().min(4, "Title must be at least 4 characters").max(100),
  description: z
    .string()
    .trim()
    .min(12, "Description should provide enough context")
    .max(1200),
});

const configSchema = z.object({
  timelock_delay: z.number().int().min(1),
  execution_window: z.number().int().min(1),
  quorum: z.number().int().min(1),
  voting_period: z.number().int().min(1),
});

const STATUS_CLASS: Record<ProposalStatus, string> = {
  [ProposalStatus.Active]: "status status-active",
  [ProposalStatus.Passed]: "status status-passed",
  [ProposalStatus.Queued]: "status status-queued",
  [ProposalStatus.Executed]: "status status-executed",
  [ProposalStatus.Cancelled]: "status status-cancelled",
  [ProposalStatus.Defeated]: "status status-defeated",
  [ProposalStatus.Expired]: "status status-expired",
};

function shortAddress(address: string | null): string {
  if (!address) {
    return "Not connected";
  }

  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

function formatLedgerDelta(current: number, target: number): string {
  const diff = target - current;

  if (diff === 0) {
    return "Now";
  }

  if (diff > 0) {
    return `${diff} ledgers left`;
  }

  return `${Math.abs(diff)} ledgers ago`;
}

function ProposalCard({
  proposal,
  latestLedger,
  actionInFlight,
  hasVoted,
  isExecutable,
  onVote,
  onFinalize,
  onQueue,
  onExecute,
  onCancel,
}: {
  proposal: Proposal;
  latestLedger: number;
  actionInFlight: string | null;
  hasVoted: boolean;
  isExecutable: boolean;
  onVote: (proposalId: number, support: 0 | 1 | 2) => Promise<void>;
  onFinalize: (proposalId: number) => Promise<void>;
  onQueue: (proposalId: number) => Promise<void>;
  onExecute: (proposalId: number) => Promise<void>;
  onCancel: (proposalId: number) => Promise<void>;
}) {
  const status = proposal.status as ProposalStatus;
  const statusClass = STATUS_CLASS[status] ?? "status";

  const canVote =
    status === ProposalStatus.Active &&
    latestLedger >= proposal.vote_start &&
    latestLedger <= proposal.vote_end &&
    !hasVoted;
  const canFinalize = status === ProposalStatus.Active && latestLedger > proposal.vote_end;
  const canQueue = status === ProposalStatus.Passed;
  const canExecute = status === ProposalStatus.Queued && isExecutable;
  const canCancel =
    status !== ProposalStatus.Executed && status !== ProposalStatus.Cancelled;

  const proposalBusy = actionInFlight?.includes(`-${proposal.id}`) ?? false;

  return (
    <article className="proposal-card">
      <div className="proposal-header-row">
        <span className="proposal-id">Proposal #{proposal.id}</span>
        <span className={statusClass}>{PROPOSAL_STATUS_LABEL[status]}</span>
      </div>

      <h3>{decodeBytesToText(proposal.title)}</h3>
      <p className="proposal-description">{decodeBytesToText(proposal.description)}</p>

      <div className="proposal-grid">
        <span>For: {proposal.votes_for}</span>
        <span>Against: {proposal.votes_against}</span>
        <span>Abstain: {proposal.votes_abstain}</span>
        <span>Vote End: L{proposal.vote_end}</span>
      </div>

      <div className="timeline">
        <span>Now: L{latestLedger}</span>
        <span>Vote Window: {formatLedgerDelta(latestLedger, proposal.vote_end)}</span>
        {proposal.status === ProposalStatus.Queued && (
          <>
            <span>Executable: L{proposal.executable_at}</span>
            <span>Expires: L{proposal.expires_at}</span>
          </>
        )}
      </div>

      <div className="actions-row">
        <button disabled={!canVote || proposalBusy} onClick={() => void onVote(proposal.id, 1)}>
          Vote For
        </button>
        <button disabled={!canVote || proposalBusy} onClick={() => void onVote(proposal.id, 0)}>
          Vote Against
        </button>
        <button disabled={!canVote || proposalBusy} onClick={() => void onVote(proposal.id, 2)}>
          Abstain
        </button>
      </div>

      <div className="actions-row">
        <button disabled={!canFinalize || proposalBusy} onClick={() => void onFinalize(proposal.id)}>
          Finalize
        </button>
        <button disabled={!canQueue || proposalBusy} onClick={() => void onQueue(proposal.id)}>
          Queue
        </button>
        <button disabled={!canExecute || proposalBusy} onClick={() => void onExecute(proposal.id)}>
          Execute
        </button>
        <button disabled={!canCancel || proposalBusy} onClick={() => void onCancel(proposal.id)}>
          Cancel
        </button>
      </div>

      {hasVoted && <p className="subtle-note">You already voted on this proposal.</p>}
      {status === ProposalStatus.Queued && !isExecutable && (
        <p className="subtle-note">Queued but not yet executable at current ledger.</p>
      )}
    </article>
  );
}

export function GovernanceDashboard() {
  const wallet = useWallet();
  const governance = useGovernance(wallet.address);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const overview = governance.overview;

  const walletLabel = useMemo(() => shortAddress(wallet.address), [wallet.address]);

  const onCreateProposal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const parsed = proposalSchema.safeParse({ title, description });
    if (!parsed.success) {
      return;
    }

    await governance.actions.createProposal(parsed.data.title, parsed.data.description);
    setTitle("");
    setDescription("");
  };

  const onSaveConfig = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const formPayload = {
      timelock_delay: Number(formData.get("timelock_delay")),
      execution_window: Number(formData.get("execution_window")),
      quorum: Number(formData.get("quorum")),
      voting_period: Number(formData.get("voting_period")),
    };

    const parsed = configSchema.safeParse(formPayload);
    if (!parsed.success) {
      return;
    }

    await governance.actions.saveConfig(parsed.data);
  };

  return (
    <div className="page-wrap">
      <header className="hero">
        <div>
          <p className="eyebrow">Timelock Governance</p>
          <h1>Secure proposal flow with enforced execution delay</h1>
          <p className="hero-copy">
            Proposals cannot be executed immediately after passing. They must clear vote,
            finalize, queue, and delay windows before execution.
          </p>
        </div>

        <div className="wallet-panel">
          <p className="subtle-note">Wallet</p>
          <p className="wallet-address">{walletLabel}</p>
          <div className="actions-row">
            <button
              disabled={wallet.isConnecting || !wallet.isAvailable}
              onClick={() => void wallet.connect()}
            >
              {wallet.isConnecting ? "Connecting..." : "Connect Freighter"}
            </button>
            <button disabled={!wallet.address} onClick={() => wallet.disconnect()}>
              Disconnect
            </button>
            <button disabled={governance.refreshing} onClick={() => void governance.refresh()}>
              Refresh
            </button>
          </div>
          {!wallet.isAvailable && (
            <p className="subtle-note">Install Freighter extension to enable write actions.</p>
          )}
        </div>
      </header>

      {governance.error && <p className="error-banner">{governance.error}</p>}
      {wallet.error && <p className="error-banner">{wallet.error}</p>}

      <section className="metrics-grid">
        <article className="metric-card">
          <span>Total Proposals</span>
          <strong>{overview?.proposalCount ?? 0}</strong>
        </article>
        <article className="metric-card">
          <span>Latest Ledger</span>
          <strong>{overview?.latestLedger ?? "-"}</strong>
        </article>
        <article className="metric-card">
          <span>Paused</span>
          <strong>{overview?.config.paused ? "Yes" : "No"}</strong>
        </article>
        <article className="metric-card">
          <span>Active Proposals</span>
          <strong>
            {overview?.proposals.filter((proposal) => proposal.status === ProposalStatus.Active).length ??
              0}
          </strong>
        </article>
      </section>

      <section className="panel-grid">
        <article className="panel">
          <h2>Create Proposal</h2>
          <p className="subtle-note">Keep titles short and use description for rationale and impact.</p>
          <form className="form-stack" onSubmit={onCreateProposal}>
            <label>
              Title
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Adjust quorum policy"
              />
            </label>
            <label>
              Description
              <textarea
                rows={4}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Why this proposal matters, expected impact, and timing"
              />
            </label>
            <button disabled={!wallet.address || governance.actionInFlight === "propose"}>
              Submit Proposal
            </button>
          </form>
        </article>

        <article className="panel">
          <h2>Guardian and Admin Controls</h2>
          <p className="subtle-note">
            Guardian can pause and cancel. Admin can update config and cancel.
          </p>

          <div className="actions-row">
            <button
              disabled={!wallet.address || governance.actionInFlight === "set-paused"}
              onClick={() => void governance.actions.togglePaused(true)}
            >
              Pause
            </button>
            <button
              disabled={!wallet.address || governance.actionInFlight === "set-paused"}
              onClick={() => void governance.actions.togglePaused(false)}
            >
              Unpause
            </button>
          </div>

          <form className="form-stack" onSubmit={onSaveConfig}>
            <label>
              Timelock Delay
              <input
                name="timelock_delay"
                type="number"
                min={1}
                defaultValue={overview?.config.timelock_delay ?? 50}
              />
            </label>

            <label>
              Execution Window
              <input
                name="execution_window"
                type="number"
                min={1}
                defaultValue={overview?.config.execution_window ?? 100}
              />
            </label>

            <label>
              Quorum
              <input
                name="quorum"
                type="number"
                min={1}
                defaultValue={overview?.config.quorum ?? 3}
              />
            </label>

            <label>
              Voting Period
              <input
                name="voting_period"
                type="number"
                min={1}
                defaultValue={overview?.config.voting_period ?? 20}
              />
            </label>

            <button disabled={!wallet.address || governance.actionInFlight === "update-config"}>
              Save Config
            </button>
          </form>
        </article>
      </section>

      <section className="proposal-list-section">
        <div className="proposal-list-header">
          <h2>Proposals</h2>
          {governance.loading && <p className="subtle-note">Loading proposals...</p>}
        </div>

        {!governance.loading && (overview?.proposals.length ?? 0) === 0 && (
          <article className="panel">
            <p>No proposals yet. Create the first one to start governance.</p>
          </article>
        )}

        <div className="proposal-list">
          {overview?.proposals.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              latestLedger={overview.latestLedger}
              actionInFlight={governance.actionInFlight}
              hasVoted={governance.votedMap[proposal.id] ?? false}
              isExecutable={governance.executableMap[proposal.id] ?? false}
              onVote={governance.actions.castVote}
              onFinalize={governance.actions.finalizeProposal}
              onQueue={governance.actions.queueProposal}
              onExecute={governance.actions.executeProposal}
              onCancel={governance.actions.cancelProposal}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
