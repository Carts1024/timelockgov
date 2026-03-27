"use client";

import { FormEvent, useMemo, useState, useSyncExternalStore } from "react";
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

const TUTORIAL_STORAGE_KEY = "timelockgov.tutorialSeen";

function subscribeTutorialSeen(): () => void {
  return () => undefined;
}

function getTutorialSeenSnapshot(): boolean {
  return window.localStorage.getItem(TUTORIAL_STORAGE_KEY) === "1";
}

function getTutorialSeenServerSnapshot(): boolean {
  // Keep SSR and hydration output stable, then reconcile from localStorage.
  return true;
}

const TUTORIAL_TERMS: Array<{ term: string; meaning: string }> = [
  {
    term: "Ledger",
    meaning: "A blockchain tick. Voting and execution timing are measured in ledger numbers, not wall-clock time.",
  },
  {
    term: "Proposal",
    meaning: "A governance item created by a proposer. It goes through voting, finalization, and potentially execution.",
  },
  {
    term: "Vote Window",
    meaning: "The ledger interval where voting is open. You can vote only between vote_start and vote_end.",
  },
  {
    term: "Quorum",
    meaning: "Minimum participation threshold required for a proposal to be considered valid.",
  },
  {
    term: "Finalize",
    meaning: "Closes an active proposal after voting ends and marks it as Passed or Defeated.",
  },
  {
    term: "Queue",
    meaning: "Moves a passed proposal into timelock so it can only be executed after the delay.",
  },
  {
    term: "Timelock Delay",
    meaning: "Required number of ledgers to wait after queueing before execution is allowed.",
  },
  {
    term: "Execution Window",
    meaning: "Limited ledger range where a queued proposal can be executed before it expires.",
  },
  {
    term: "Execute",
    meaning: "Applies the queued proposal action after timelock delay has elapsed and before expiry.",
  },
  {
    term: "Guardian",
    meaning: "Safety role that can pause the system and cancel proposals.",
  },
  {
    term: "Admin",
    meaning: "Role that can update governance configuration and cancel proposals.",
  },
  {
    term: "Paused",
    meaning: "Emergency mode where state-changing actions are blocked until unpaused.",
  },
];

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
  onVote: (proposalId: number, support: 0 | 1 | 2) => Promise<string | null>;
  onFinalize: (proposalId: number) => Promise<string | null>;
  onQueue: (proposalId: number) => Promise<string | null>;
  onExecute: (proposalId: number) => Promise<string | null>;
  onCancel: (proposalId: number) => Promise<string | null>;
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

  let voteDisabledReason: string | null = null;
  if (!canVote) {
    if (status !== ProposalStatus.Active) {
      voteDisabledReason = "Voting is only available while proposal status is Active.";
    } else if (latestLedger < proposal.vote_start) {
      voteDisabledReason = `Voting opens at ledger L${proposal.vote_start}.`;
    } else if (latestLedger > proposal.vote_end) {
      voteDisabledReason = "Voting window already closed. Finalize to move proposal state.";
    } else if (hasVoted) {
      voteDisabledReason = "You already voted on this proposal.";
    }
  }

  const queueDisabledReason =
    status !== ProposalStatus.Passed
      ? "Queue is available only after proposal status becomes Passed."
      : null;

  const executeDisabledReason =
    status !== ProposalStatus.Queued
      ? "Execute is available only when proposal status is Queued."
      : !isExecutable
        ? `Execution not unlocked yet. Available at L${proposal.executable_at}.`
        : null;

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
      {!proposalBusy && voteDisabledReason && <p className="subtle-note">{voteDisabledReason}</p>}

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
      {!proposalBusy && queueDisabledReason && <p className="subtle-note">{queueDisabledReason}</p>}
      {!proposalBusy && executeDisabledReason && <p className="subtle-note">{executeDisabledReason}</p>}

      {hasVoted && <p className="subtle-note">You already voted on this proposal.</p>}
      {status === ProposalStatus.Queued && !isExecutable && (
        <p className="subtle-note">Queued but not yet executable at current ledger.</p>
      )}
    </article>
  );
}

function getProposalReactKey(proposal: Proposal, index: number): string {
  const idPart = String(proposal.id);
  const proposerPart = String(proposal.proposer);
  const voteStartPart = String(proposal.vote_start);
  return `${idPart}-${proposerPart}-${voteStartPart}-${index}`;
}

export function GovernanceDashboard() {
  const wallet = useWallet();
  const governance = useGovernance(wallet.address);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [proposalFormError, setProposalFormError] = useState<string | null>(null);
  const [proposalFormSuccess, setProposalFormSuccess] = useState<string | null>(null);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [tutorialSeenOverride, setTutorialSeenOverride] = useState<boolean | null>(null);

  const tutorialSeenSnapshot = useSyncExternalStore(
    subscribeTutorialSeen,
    getTutorialSeenSnapshot,
    getTutorialSeenServerSnapshot
  );

  const hasSeenTutorial = tutorialSeenOverride ?? tutorialSeenSnapshot;
  const isTutorialVisible = isTutorialOpen || !hasSeenTutorial;

  const overview = governance.overview;

  const walletLabel = useMemo(() => shortAddress(wallet.address), [wallet.address]);

  const closeTutorial = () => {
    setIsTutorialOpen(false);
    window.localStorage.setItem(TUTORIAL_STORAGE_KEY, "1");
    setTutorialSeenOverride(true);
  };

  const onCreateProposal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setProposalFormError(null);
    setProposalFormSuccess(null);

    const parsed = proposalSchema.safeParse({ title, description });
    if (!parsed.success) {
      setProposalFormError(parsed.error.issues[0]?.message ?? "Please check proposal inputs.");
      return;
    }

    const submitError = await governance.actions.createProposal(
      parsed.data.title,
      parsed.data.description
    );

    if (submitError) {
      setProposalFormError(submitError);
      return;
    }

    setTitle("");
    setDescription("");
    setProposalFormSuccess("Proposal submitted successfully.");
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
          <div className="hero-actions">
            <button type="button" onClick={() => setIsTutorialOpen(true)}>
              Tutorial
            </button>
          </div>
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
            {proposalFormError && <p className="inline-error">{proposalFormError}</p>}
            {proposalFormSuccess && <p className="inline-success">{proposalFormSuccess}</p>}
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
          {overview?.proposals.map((proposal, index) => (
            <ProposalCard
              key={getProposalReactKey(proposal, index)}
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

      {isTutorialVisible && (
        <div className="tutorial-overlay" role="presentation" onClick={closeTutorial}>
          <article
            className="tutorial-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Governance tutorial"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="tutorial-header">
              <h2>How This Governance Flow Works</h2>
              <button type="button" onClick={closeTutorial}>
                Close
              </button>
            </header>

            <p className="subtle-note">
              Quick glossary for the terms used across this dashboard.
            </p>

            <div className="tutorial-grid">
              {TUTORIAL_TERMS.map(({ term, meaning }) => (
                <section key={term} className="tutorial-term-card">
                  <h3>{term}</h3>
                  <p>{meaning}</p>
                </section>
              ))}
            </div>
          </article>
        </div>
      )}
    </div>
  );
}
