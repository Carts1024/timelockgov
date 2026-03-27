import { Networks } from "@stellar/stellar-sdk";

export const SOROBAN_RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";

export const STELLAR_NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;

export const TIMELOCK_CONTRACT_ID =
  process.env.NEXT_PUBLIC_TIMELOCK_CONTRACT_ID ??
  "CBQN3ENF5FNGLVYD4TWX3MIWI2T2AM57D3EPH4CSIOPVW7O5ILBZLQ7K";

export const ALLOW_HTTP_RPC = process.env.NEXT_PUBLIC_ALLOW_HTTP_RPC === "true";

export const LEDGER_POLL_INTERVAL_MS = 5000;
