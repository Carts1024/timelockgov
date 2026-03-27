import { contract, rpc } from "@stellar/stellar-sdk";

import {
  ALLOW_HTTP_RPC,
  SOROBAN_RPC_URL,
  STELLAR_NETWORK_PASSPHRASE,
  TIMELOCK_CONTRACT_ID,
} from "./constants";
import { encodeTextToBytes } from "./codec";
import { signTransaction } from "./wallet";
import { ProposalStatus, type Proposal, type TimelockConfig, type VoteSupport } from "./types";

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

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function toStringValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "bigint" || typeof value === "number") {
    return String(value);
  }

  if (value && typeof (value as { toString?: () => string }).toString === "function") {
    return (value as { toString: () => string }).toString();
  }

  return fallback;
}

function getObjectField(
  source: Record<string, unknown>,
  ...keys: string[]
): unknown {
  for (const key of keys) {
    if (key in source) {
      return source[key];
    }
  }
  return undefined;
}

function toPlainObject(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  if (raw instanceof Map) {
    return Object.fromEntries(
      Array.from(raw.entries()).map(([key, value]) => [String(key), value])
    );
  }

  if ("entries" in raw && typeof (raw as { entries?: () => Iterable<unknown> }).entries === "function") {
    try {
      const entries = Array.from(
        (raw as { entries: () => Iterable<[unknown, unknown]> }).entries()
      ).map(([key, value]) => [String(key), value] as const);

      if (entries.length > 0) {
        return Object.fromEntries(entries);
      }
    } catch {
      // Ignore and continue trying other representations.
    }
  }

  const asRecord = raw as Record<string, unknown>;

  if ("value" in asRecord) {
    const inner = toPlainObject(asRecord.value);
    if (inner) {
      return inner;
    }
  }

  if ("result" in asRecord) {
    const inner = toPlainObject(asRecord.result);
    if (inner) {
      return inner;
    }
  }

  if ("_value" in asRecord) {
    const inner = toPlainObject(asRecord._value);
    if (inner) {
      return inner;
    }
  }

  if ("_attributes" in asRecord) {
    const attributes = toPlainObject(asRecord._attributes);
    if (attributes) {
      return attributes;
    }
  }

  if ("toJSON" in asRecord && typeof asRecord.toJSON === "function") {
    try {
      const fromJson = toPlainObject(asRecord.toJSON());
      if (fromJson) {
        return fromJson;
      }
    } catch {
      // Ignore JSON conversion errors.
    }
  }

  return asRecord;
}

function normalizeProposal(raw: unknown): Proposal {
  if (Array.isArray(raw)) {
    return {
      id: toNumber(raw[0]),
      proposer: toStringValue(raw[1]),
      title: (raw[2] as Uint8Array | string | undefined) ?? "",
      description: (raw[3] as Uint8Array | string | undefined) ?? "",
      vote_start: toNumber(raw[4]),
      vote_end: toNumber(raw[5]),
      queued_at: toNumber(raw[6]),
      executable_at: toNumber(raw[7]),
      expires_at: toNumber(raw[8]),
      votes_for: toNumber(raw[9]),
      votes_against: toNumber(raw[10]),
      votes_abstain: toNumber(raw[11]),
      status: toNumber(raw[12]) as ProposalStatus,
    };
  }

  const proposal = toPlainObject(raw);
  if (proposal) {
    const fields = toPlainObject(getObjectField(proposal, "fields", "value", "data")) ?? proposal;

    return {
      id: toNumber(getObjectField(fields, "id")),
      proposer: toStringValue(getObjectField(fields, "proposer")),
      title: (getObjectField(fields, "title") as Uint8Array | string | undefined) ?? "",
      description:
        (getObjectField(fields, "description") as Uint8Array | string | undefined) ?? "",
      vote_start: toNumber(getObjectField(fields, "vote_start", "voteStart")),
      vote_end: toNumber(getObjectField(fields, "vote_end", "voteEnd")),
      queued_at: toNumber(getObjectField(fields, "queued_at", "queuedAt")),
      executable_at: toNumber(getObjectField(fields, "executable_at", "executableAt")),
      expires_at: toNumber(getObjectField(fields, "expires_at", "expiresAt")),
      votes_for: toNumber(getObjectField(fields, "votes_for", "votesFor")),
      votes_against: toNumber(getObjectField(fields, "votes_against", "votesAgainst")),
      votes_abstain: toNumber(getObjectField(fields, "votes_abstain", "votesAbstain")),
      status: toNumber(getObjectField(fields, "status")) as ProposalStatus,
    };
  }

  throw new Error("Unexpected proposal response shape from contract.");
}

function normalizeConfig(raw: unknown): TimelockConfig {
  if (Array.isArray(raw)) {
    return {
      timelock_delay: toNumber(raw[0]),
      execution_window: toNumber(raw[1]),
      quorum: toNumber(raw[2]),
      voting_period: toNumber(raw[3]),
      paused: Boolean(raw[4]),
    };
  }

  const config = toPlainObject(raw);
  if (config) {
    const fields = toPlainObject(getObjectField(config, "fields", "value", "data")) ?? config;

    return {
      timelock_delay: toNumber(getObjectField(fields, "timelock_delay", "timelockDelay")),
      execution_window: toNumber(
        getObjectField(fields, "execution_window", "executionWindow")
      ),
      quorum: toNumber(getObjectField(fields, "quorum")),
      voting_period: toNumber(getObjectField(fields, "voting_period", "votingPeriod")),
      paused: Boolean(getObjectField(fields, "paused")),
    };
  }

  throw new Error("Unexpected config response shape from contract.");
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
  const raw = await callRead<unknown>("get_config");
  return normalizeConfig(raw);
}

export async function getProposalCount(): Promise<number> {
  return callRead<number>("proposal_count");
}

export async function getProposal(proposalId: number): Promise<Proposal> {
  const raw = await callRead<unknown>("get_proposal", { proposal_id: proposalId });
  return normalizeProposal(raw);
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
