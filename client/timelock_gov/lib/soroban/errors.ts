import { ContractErrorCode } from "./types";

const ERROR_LABEL: Record<number, string> = {
  [ContractErrorCode.NotInitialized]: "Contract is not initialized yet.",
  [ContractErrorCode.AlreadyInitialized]: "Contract has already been initialized.",
  [ContractErrorCode.Unauthorized]: "You are not authorized for this action.",
  [ContractErrorCode.ProposalNotFound]: "Proposal not found.",
  [ContractErrorCode.ProposalAlreadyQueued]: "Proposal is already queued.",
  [ContractErrorCode.ProposalAlreadyExecuted]: "Proposal is already executed.",
  [ContractErrorCode.ProposalAlreadyCancelled]: "Proposal is already cancelled.",
  [ContractErrorCode.DelayNotElapsed]: "Timelock delay has not elapsed yet.",
  [ContractErrorCode.ExecutionWindowExpired]: "Execution window has expired.",
  [ContractErrorCode.InvalidDelay]: "Timelock delay must be greater than 0.",
  [ContractErrorCode.InvalidExecutionWindow]: "Execution window must be greater than 0.",
  [ContractErrorCode.QuorumNotMet]: "Proposal did not reach quorum.",
  [ContractErrorCode.VotingStillActive]: "Voting is not in a finalizable state.",
  [ContractErrorCode.AlreadyVoted]: "You have already voted on this proposal.",
  [ContractErrorCode.ProposalNotQueued]: "Proposal is not queued.",
  [ContractErrorCode.ProposalNotPassed]: "Only passed proposals can be queued.",
};

export function getReadableError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    const parsed = parseErrorCode(error.message);
    if (parsed) {
      return ERROR_LABEL[parsed] ?? error.message;
    }
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    const maybeCode = (error as { code?: number }).code;
    if (typeof maybeCode === "number" && ERROR_LABEL[maybeCode]) {
      return ERROR_LABEL[maybeCode];
    }

    const maybeMessage = (error as { message?: string }).message;
    if (maybeMessage) {
      const parsed = parseErrorCode(maybeMessage);
      return parsed ? (ERROR_LABEL[parsed] ?? maybeMessage) : maybeMessage;
    }
  }

  return "Transaction failed. Please try again.";
}

function parseErrorCode(message: string): number | null {
  const hashMatch = message.match(/#(\d{1,4})/);
  if (hashMatch) {
    return Number(hashMatch[1]);
  }

  const codeMatch = message.match(/code\D+(\d{1,4})/i);
  if (codeMatch) {
    return Number(codeMatch[1]);
  }

  return null;
}
