import { contract, rpc } from "@stellar/stellar-sdk";

import {
  ALLOW_HTTP_RPC,
  SOROBAN_RPC_URL,
  STELLAR_NETWORK_PASSPHRASE,
  TIMELOCK_CONTRACT_ID,
} from "./constants";
import { encodeTextToBytes } from "./codec";
import { signTransaction } from "./wallet";
import type { Proposal, TimelockConfig, VoteSupport } from "./types";

type DynamicClient = contract.Client & {
  [method: string]: (...args: unknown[]) => Promise<unknown>;
};

type ReadCallResult = {
  result: unknown;
};

type WriteCallResult = {
  signAndSend: () => Promise<{
    result: unknown;
  }>;
};

let cachedReadClient: Promise<DynamicClient> | null = null;
let cachedRpcServer: rpc.Server | null = null;

function getRpcServer(): rpc.Server {
  if (!cachedRpcServer) {
    cachedRpcServer = new rpc.Server(SOROBAN_RPC_URL, {
      allowHttp: ALLOW_HTTP_RPC,
    });
  }
  return cachedRpcServer;
}

async function getReadClient(): Promise<DynamicClient> {
  if (!cachedReadClient) {
    cachedReadClient = contract.Client.from({
      contractId: TIMELOCK_CONTRACT_ID,
      rpcUrl: SOROBAN_RPC_URL,
      networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      allowHttp: ALLOW_HTTP_RPC,
    }) as Promise<DynamicClient>;
  }

  return cachedReadClient;
}

async function getWriteClient(signerAddress: string): Promise<DynamicClient> {
  return (contract.Client.from({
    contractId: TIMELOCK_CONTRACT_ID,
    rpcUrl: SOROBAN_RPC_URL,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    publicKey: signerAddress,
    signTransaction,
    allowHttp: ALLOW_HTTP_RPC,
  }) as Promise<DynamicClient>);
}

async function callRead<T>(method: string, args?: Record<string, unknown>): Promise<T> {
  const client = await getReadClient();
  const fn = client[method];

  if (typeof fn !== "function") {
    throw new Error(`Contract method ${method} not found.`);
  }

  const tx = (args ? await fn(args) : await fn()) as ReadCallResult;
  return tx.result as T;
}

async function callWrite<T>(
  signerAddress: string,
  method: string,
  args: Record<string, unknown>
): Promise<T> {
  const client = await getWriteClient(signerAddress);
  const fn = client[method];

  if (typeof fn !== "function") {
    throw new Error(`Contract method ${method} not found.`);
  }

  const tx = (await fn(args, {
    publicKey: signerAddress,
    signTransaction,
  })) as WriteCallResult;

  const sent = await tx.signAndSend();
  return sent.result as T;
}

export async function getLatestLedgerSequence(): Promise<number> {
  const response = await getRpcServer().getLatestLedger();
  return response.sequence;
}

export async function getConfig(): Promise<TimelockConfig> {
  return callRead<TimelockConfig>("get_config");
}

export async function getProposalCount(): Promise<number> {
  return callRead<number>("proposal_count");
}

export async function getProposal(proposalId: number): Promise<Proposal> {
  return callRead<Proposal>("get_proposal", { proposal_id: proposalId });
}

export async function hasVoted(proposalId: number, voter: string): Promise<boolean> {
  return callRead<boolean>("has_voted", {
    proposal_id: proposalId,
    voter,
  });
}

export async function isExecutable(proposalId: number): Promise<boolean> {
  return callRead<boolean>("is_executable", { proposal_id: proposalId });
}

export async function propose(
  signerAddress: string,
  title: string,
  description: string
): Promise<number> {
  return callWrite<number>(signerAddress, "propose", {
    proposer: signerAddress,
    title: encodeTextToBytes(title),
    description: encodeTextToBytes(description),
  });
}

export async function vote(
  signerAddress: string,
  proposalId: number,
  support: VoteSupport
): Promise<void> {
  return callWrite<void>(signerAddress, "vote", {
    voter: signerAddress,
    proposal_id: proposalId,
    support,
  });
}

export async function finalize(signerAddress: string, proposalId: number): Promise<number> {
  return callWrite<number>(signerAddress, "finalize", { proposal_id: proposalId });
}

export async function queue(signerAddress: string, proposalId: number): Promise<number> {
  return callWrite<number>(signerAddress, "queue", {
    caller: signerAddress,
    proposal_id: proposalId,
  });
}

export async function execute(signerAddress: string, proposalId: number): Promise<void> {
  return callWrite<void>(signerAddress, "execute", {
    caller: signerAddress,
    proposal_id: proposalId,
  });
}

export async function cancel(signerAddress: string, proposalId: number): Promise<void> {
  return callWrite<void>(signerAddress, "cancel", {
    caller: signerAddress,
    proposal_id: proposalId,
  });
}

export async function setPaused(signerAddress: string, paused: boolean): Promise<void> {
  return callWrite<void>(signerAddress, "set_paused", {
    caller: signerAddress,
    paused,
  });
}

export async function updateConfig(
  signerAddress: string,
  payload: {
    timelock_delay: number;
    execution_window: number;
    quorum: number;
    voting_period: number;
  }
): Promise<void> {
  return callWrite<void>(signerAddress, "update_config", {
    caller: signerAddress,
    timelock_delay: payload.timelock_delay,
    execution_window: payload.execution_window,
    quorum: payload.quorum,
    voting_period: payload.voting_period,
  });
}
