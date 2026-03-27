export enum ProposalStatus {
  Active = 0,
  Passed = 1,
  Queued = 2,
  Executed = 3,
  Cancelled = 4,
  Defeated = 5,
  Expired = 6,
}

export enum ContractErrorCode {
  NotInitialized = 1,
  AlreadyInitialized = 2,
  Unauthorized = 3,
  ProposalNotFound = 4,
  ProposalAlreadyQueued = 5,
  ProposalAlreadyExecuted = 6,
  ProposalAlreadyCancelled = 7,
  DelayNotElapsed = 8,
  ExecutionWindowExpired = 9,
  InvalidDelay = 10,
  InvalidExecutionWindow = 11,
  QuorumNotMet = 12,
  VotingStillActive = 13,
  AlreadyVoted = 14,
  ProposalNotQueued = 15,
  ProposalNotPassed = 16,
}

export type VoteSupport = 0 | 1 | 2;

export interface Proposal {
  id: number;
  proposer: string;
  title: Uint8Array | string;
  description: Uint8Array | string;
  vote_start: number;
  vote_end: number;
  queued_at: number;
  executable_at: number;
  expires_at: number;
  votes_for: number;
  votes_against: number;
  votes_abstain: number;
  status: ProposalStatus;
}

export interface TimelockConfig {
  timelock_delay: number;
  execution_window: number;
  quorum: number;
  voting_period: number;
  paused: boolean;
}

export interface GovernanceOverview {
  latestLedger: number;
  proposalCount: number;
  config: TimelockConfig;
  proposals: Proposal[];
}

export const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  [ProposalStatus.Active]: "Active",
  [ProposalStatus.Passed]: "Passed",
  [ProposalStatus.Queued]: "Queued",
  [ProposalStatus.Executed]: "Executed",
  [ProposalStatus.Cancelled]: "Cancelled",
  [ProposalStatus.Defeated]: "Defeated",
  [ProposalStatus.Expired]: "Expired",
};
