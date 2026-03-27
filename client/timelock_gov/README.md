# TimelockGov Frontend

Next.js dashboard for the Soroban timelock governance contract.

## Features

- Freighter wallet connection for signing transactions
- Live contract reads: config, proposal count, proposal list, vote status, executable status
- Governance actions: propose, vote, finalize, queue, execute, cancel
- Admin and guardian controls: pause or unpause and update config
- Ledger-aware proposal timeline and status cards

## Setup

1. Install dependencies:

```bash
pnpm install
```

2. Create env file:

```bash
cp .env.example .env.local
```

3. Start dev server:

```bash
pnpm dev
```

Open http://localhost:3000.

## Environment Variables

- `NEXT_PUBLIC_SOROBAN_RPC_URL`: Soroban RPC URL
- `NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE`: Stellar network passphrase
- `NEXT_PUBLIC_TIMELOCK_CONTRACT_ID`: deployed contract ID
- `NEXT_PUBLIC_ALLOW_HTTP_RPC`: set `true` only for local non-HTTPS RPC

## Notes

- Freighter browser extension must be installed for write actions.
- The dashboard reads proposals directly from chain by looping IDs from `proposal_count`.
- All timing is ledger based, not wall-clock based.
