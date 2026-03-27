# timelockgov

Governance with enforced delay. Proposals that pass a community vote cannot be executed immediately — they enter a mandatory waiting period, giving token holders time to review, contest, or exit before changes take effect.

---

## Why This Exists

On-chain governance without a timelock is dangerous. A passed proposal can be executed in the same block it reaches quorum — faster than any community member can react. This has been the root cause of multiple governance exploits across DeFi where attackers accumulate votes, pass a malicious proposal, and drain a treasury in a single transaction.

`timelockgov` adds a mandatory buffer between "passed" and "executed." Every proposal must clear three gates before any action happens: a vote, a finalization check, and a timelock queue. Only after the delay expires — and before the execution window closes — can a proposal actually run.

---

## The Lifecycle of a Proposal
```
Propose → Vote → Finalize → Queue → [Timelock Delay] → Execute
                     ↓
                 Defeated / Cancelled / Expired
```

Each stage has explicit rules:

**Propose** — any address can submit a proposal with a title and description. Voting opens at the current ledger.

**Vote** — token holders cast `For`, `Against`, or `Abstain` votes during the voting window. Each address may vote once.

**Finalize** — after the voting window closes, anyone can call `finalize`. The contract checks whether quorum was reached and whether `For` beats `Against`. The proposal is marked `Passed` or `Defeated`.

**Queue** — a passed proposal is queued into the timelock. The executable timestamp is set to `current_ledger + timelock_delay`. The expiry is set to `executable_at + execution_window`.

**Execute** — after the delay elapses and before the window expires, the proposal can be executed. If no one executes within the window, it expires permanently.

At any stage before execution, the admin or guardian can `cancel`.

---

## Configuration Parameters

| Parameter | Description |
|---|---|
| `timelock_delay` | Ledgers between queue and earliest execution. Must be > 0. |
| `execution_window` | Ledgers after the delay during which execution is allowed. Expires permanently after this. |
| `quorum` | Minimum total `For` votes for a proposal to pass. |
| `voting_period` | How many ledgers a proposal stays open for voting. |

A reasonable testnet configuration: `timelock_delay = 50`, `execution_window = 100`, `quorum = 3`, `voting_period = 20`.

On mainnet, delays should be calibrated to real time. Stellar produces roughly 5–7 ledgers per second, so a 24-hour delay is approximately 432,000 ledgers.

---

## Roles

**Admin** — deploys and initializes the contract. Can update config, cancel proposals, and queue or execute proposals. The admin is typically a multisig or itself a governed contract.

**Guardian** — a separate emergency address with the power to pause the contract and cancel proposals. The guardian cannot update config or execute proposals. Intended for security teams or a multisig with a faster response time than full governance.

Separating admin and guardian powers means a compromised guardian cannot push malicious changes — they can only stop things, not execute them.

---

## Proposal Statuses

| Status | Meaning |
|---|---|
| `Active` | Voting is open |
| `Passed` | Voting closed with quorum and majority For |
| `Defeated` | Quorum not met or Against >= For |
| `Queued` | Passed and waiting out the timelock delay |
| `Executed` | Successfully executed after delay |
| `Cancelled` | Cancelled by admin or guardian before execution |
| `Expired` | Execution window passed without execution |

---

## Contract API

### Setup
```rust
fn initialize(
    e: Env,
    admin: Address,
    guardian: Address,
    timelock_delay: u32,
    execution_window: u32,
    quorum: u32,
    voting_period: u32,
) -> Result<(), Error>
```

Called once at deployment. Sets the admin, guardian, and all governance parameters. Cannot be called again.

---

### Governance Flow
```rust
fn propose(e: Env, proposer: Address, title: Bytes, description: Bytes) -> Result<u32, Error>
```
Creates a proposal. Returns the proposal ID. Voting opens at the current ledger.
```rust
fn vote(e: Env, voter: Address, proposal_id: u32, support: u32) -> Result<(), Error>
```
Casts a vote. `support`: `0` = Against, `1` = For, `2` = Abstain. Each address may vote once per proposal.
```rust
fn finalize(e: Env, proposal_id: u32) -> Result<ProposalStatus, Error>
```
Closes voting and determines the outcome. Must be called after `vote_end`. Returns the resulting status.
```rust
fn queue(e: Env, caller: Address, proposal_id: u32) -> Result<u32, Error>
```
Queues a passed proposal. Returns the `executable_at` ledger sequence.
```rust
fn execute(e: Env, caller: Address, proposal_id: u32) -> Result<(), Error>
```
Executes a queued proposal. Reverts if the delay has not elapsed or the execution window has expired.

---

### Admin and Guardian
```rust
fn cancel(e: Env, caller: Address, proposal_id: u32) -> Result<(), Error>
```
Cancels any non-executed proposal. Admin or guardian only.
```rust
fn set_paused(e: Env, caller: Address, paused: bool) -> Result<(), Error>
```
Pauses or unpauses the contract. Guardian only. When paused, `propose`, `queue`, and `execute` all revert.
```rust
fn update_config(
    e: Env,
    caller: Address,
    timelock_delay: u32,
    execution_window: u32,
    quorum: u32,
    voting_period: u32,
) -> Result<(), Error>
```
Updates governance parameters. Admin only. Changes apply to future proposals only.

---

### Queries
```rust
fn get_proposal(e: Env, proposal_id: u32) -> Result<Proposal, Error>
fn get_config(e: Env) -> Result<TimelockConfig, Error>
fn has_voted(e: Env, proposal_id: u32, voter: Address) -> bool
fn proposal_count(e: Env) -> u32
fn is_executable(e: Env, proposal_id: u32) -> bool
```

`is_executable` returns `true` only if the proposal is `Queued`, the delay has elapsed, and the execution window has not closed. Useful as a pre-check before calling `execute`.

---

## Security Properties

**Timelock delay is non-negotiable.** Once queued, a proposal cannot be executed before `executable_at` regardless of who calls `execute`. There is no admin override for the delay.

**Execution windows expire.** A queued proposal that no one executes within the execution window becomes permanently expired. This prevents stale proposals from being executed months later under different conditions.

**Guardian cannot push changes.** The guardian role is strictly defensive — pause and cancel only. It cannot update config, queue proposals, or execute anything.

**Admin changes are subject to governance.** If the admin is itself a governed contract, then changing the timelock parameters requires passing through the same governance process, preventing unilateral config changes.

**Quorum is a floor, not a majority of total supply.** `quorum` is an absolute vote count. Projects should calibrate this relative to expected participation, not total token supply.

**One vote per address.** There is no delegation in the current implementation. Each address votes with weight 1. Projects requiring weighted voting should extend the contract with a snapshot balance check.

---

## Testing
```bash
cargo test
```

| Test | What it verifies |
|---|---|
| `test_initialize` | Config stored correctly on init |
| `test_double_initialize_rejected` | Second init reverts |
| `test_propose` | Proposal created with Active status |
| `test_vote_for` | For vote increments correctly |
| `test_vote_against` | Against vote increments correctly |
| `test_vote_abstain` | Abstain vote increments correctly |
| `test_double_vote_rejected` | Second vote from same address reverts |
| `test_finalize_passed` | Proposal with quorum and majority passes |
| `test_finalize_defeated_quorum_not_met` | Below-quorum proposal is defeated |
| `test_finalize_defeated_votes_against_win` | Against majority defeats proposal |
| `test_queue_passed_proposal` | Queued proposal gets correct executable_at |
| `test_queue_not_passed_rejected` | Non-passed proposal cannot be queued |
| `test_execute_before_delay_rejected` | Execution before delay reverts |
| `test_execute_after_delay_succeeds` | Execution after delay succeeds |
| `test_execute_after_window_expired` | Execution past window marks Expired |
| `test_cancel_by_admin` | Admin can cancel any live proposal |
| `test_cancel_by_guardian` | Guardian can cancel any live proposal |
| `test_cancel_by_unauthorized_rejected` | Random address cannot cancel |
| `test_execute_cancelled_rejected` | Cancelled proposal cannot be executed |
| `test_pause_blocks_propose` | Paused contract rejects propose |
| `test_pause_blocks_queue` | Paused contract rejects queue |
| `test_pause_blocks_execute` | Paused contract rejects execute |
| `test_unpause_resumes_operations` | Operations resume after unpause |
| `test_is_executable` | is_executable reflects correct window |
| `test_update_config` | Admin can update all config params |
| `test_update_config_unauthorized_rejected` | Non-admin config update reverts |
| `test_proposal_count_increments` | Proposal count tracked correctly |
| `test_full_lifecycle` | Complete propose → vote → finalize → queue → execute flow |

---

## Build and Deploy

**Build:**
```bash
cargo build --release --target wasm32-unknown-unknown
```

**Deploy:**
```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/timelockgov.wasm \
  --source-account deployer \
  --network testnet
```

**Initialize:**
```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source-account deployer \
  --network testnet \
  -- initialize \
  --admin $(stellar keys address deployer) \
  --guardian <GUARDIAN_ADDRESS> \
  --timelock_delay 50 \
  --execution_window 100 \
  --quorum 3 \
  --voting_period 20
```

**Propose:**
```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source-account deployer \
  --network testnet \
  -- propose \
  --proposer $(stellar keys address deployer) \
  --title <HEX_ENCODED_TITLE> \
  --description <HEX_ENCODED_DESCRIPTION>
```

**Vote:**
```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source-account deployer \
  --network testnet \
  -- vote \
  --voter $(stellar keys address deployer) \
  --proposal_id 1 \
  --support 1
```

**Finalize, Queue, Execute** follow the same pattern using their respective function names.

---

## Project Structure
```
.
├── src/
│   ├── lib.rs       # Contract logic, proposal lifecycle, timelock enforcement
│   └── test.rs      # Full lifecycle and edge case tests
├── Cargo.toml
└── README.md
```
# Stellar-Bootcamp


#Contract address:

CBQN3ENF5FNGLVYD4TWX3MIWI2T2AM57D3EPH4CSIOPVW7O5ILBZLQ7K