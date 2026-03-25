#![no_std]
extern crate alloc;

use soroban_sdk::{
    contract, contracterror, contractimpl, contractmeta, contracttype,
    Address, Bytes, Env, Vec,
};

contractmeta!(
    key = "Description",
    val = "TimelockGov: Governance timelock contract — queues passed proposals with a mandatory delay before execution on Soroban"
);

#[contracterror]
#[repr(u32)]
#[derive(Clone, Copy, Eq, PartialEq, Debug)]
pub enum Error {
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

#[contracttype]
#[derive(Clone, Copy, Eq, PartialEq, Debug)]
pub enum ProposalStatus {
    /// Voting is open
    Active = 0,
    /// Voting passed, not yet queued
    Passed = 1,
    /// Queued, waiting for timelock delay
    Queued = 2,
    /// Successfully executed
    Executed = 3,
    /// Cancelled by admin or guardian
    Cancelled = 4,
    /// Voting failed to reach quorum
    Defeated = 5,
    /// Execution window expired without execution
    Expired = 6,
}

#[contracttype]
#[derive(Clone)]
pub struct Proposal {
    pub id: u32,
    pub proposer: Address,
    pub title: Bytes,
    pub description: Bytes,
    /// Ledger sequence when voting opens
    pub vote_start: u32,
    /// Ledger sequence when voting closes
    pub vote_end: u32,
    /// Ledger sequence when proposal was queued (0 if not queued)
    pub queued_at: u32,
    /// Ledger sequence when timelock delay expires and execution is allowed
    pub executable_at: u32,
    /// Ledger sequence after which execution is no longer allowed
    pub expires_at: u32,
    pub votes_for: u32,
    pub votes_against: u32,
    pub votes_abstain: u32,
    pub status: ProposalStatus,
}

#[contracttype]
#[derive(Clone)]
pub struct TimelockConfig {
    /// Mandatory delay in ledgers between queue and execution
    pub timelock_delay: u32,
    /// Window in ledgers after timelock_delay during which execution is allowed
    pub execution_window: u32,
    /// Minimum votes for a proposal to pass
    pub quorum: u32,
    /// Ledgers a proposal is open for voting
    pub voting_period: u32,
    /// Whether the timelock is paused (guardian function)
    pub paused: bool,
}

#[contracttype]
pub enum StorageKey {
    Admin,
    Guardian,
    Config,
    ProposalCount,
    Proposal(u32),
    HasVoted(u32, Address),
}

#[contract]
pub struct TimelockGov;

#[contractimpl]
impl TimelockGov {
    /// Initialize the timelock governance contract.
    pub fn initialize(
        e: Env,
        admin: Address,
        guardian: Address,
        timelock_delay: u32,
        execution_window: u32,
        quorum: u32,
        voting_period: u32,
    ) -> Result<(), Error> {
        admin.require_auth();

        if e.storage().instance().has(&StorageKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        if timelock_delay == 0 {
            return Err(Error::InvalidDelay);
        }
        if execution_window == 0 {
            return Err(Error::InvalidExecutionWindow);
        }

        let config = TimelockConfig {
            timelock_delay,
            execution_window,
            quorum,
            voting_period,
            paused: false,
        };

        e.storage().instance().set(&StorageKey::Admin, &admin);
        e.storage().instance().set(&StorageKey::Guardian, &guardian);
        e.storage().instance().set(&StorageKey::Config, &config);
        e.storage().instance().set(&StorageKey::ProposalCount, &0u32);

        Ok(())
    }

    /// Create a new governance proposal. Voting opens immediately.
    pub fn propose(
        e: Env,
        proposer: Address,
        title: Bytes,
        description: Bytes,
    ) -> Result<u32, Error> {
        proposer.require_auth();
        Self::require_not_paused(&e)?;

        let config: TimelockConfig = e
            .storage()
            .instance()
            .get(&StorageKey::Config)
            .ok_or(Error::NotInitialized)?;

        let count: u32 = e
            .storage()
            .instance()
            .get(&StorageKey::ProposalCount)
            .unwrap_or(0);

        let id = count + 1;
        let current = e.ledger().sequence();

        let proposal = Proposal {
            id,
            proposer,
            title,
            description,
            vote_start: current,
            vote_end: current + config.voting_period,
            queued_at: 0,
            executable_at: 0,
            expires_at: 0,
            votes_for: 0,
            votes_against: 0,
            votes_abstain: 0,
            status: ProposalStatus::Active,
        };

        e.storage()
            .instance()
            .set(&StorageKey::Proposal(id), &proposal);
        e.storage()
            .instance()
            .set(&StorageKey::ProposalCount, &id);

        Ok(id)
    }

    /// Cast a vote on an active proposal.
    pub fn vote(
        e: Env,
        voter: Address,
        proposal_id: u32,
        support: u32, // 0 = against, 1 = for, 2 = abstain
    ) -> Result<(), Error> {
        voter.require_auth();

        let mut proposal: Proposal = e
            .storage()
            .instance()
            .get(&StorageKey::Proposal(proposal_id))
            .ok_or(Error::ProposalNotFound)?;

        if proposal.status != ProposalStatus::Active {
            return Err(Error::VotingStillActive);
        }

        let current = e.ledger().sequence();
        if current > proposal.vote_end {
            return Err(Error::VotingStillActive);
        }
        if current < proposal.vote_start {
            return Err(Error::VotingStillActive);
        }

        // Check already voted
        let voted: bool = e
            .storage()
            .instance()
            .get(&StorageKey::HasVoted(proposal_id, voter.clone()))
            .unwrap_or(false);
        if voted {
            return Err(Error::AlreadyVoted);
        }

        match support {
            1 => proposal.votes_for += 1,
            0 => proposal.votes_against += 1,
            2 => proposal.votes_abstain += 1,
            _ => proposal.votes_against += 1,
        }

        e.storage()
            .instance()
            .set(&StorageKey::HasVoted(proposal_id, voter), &true);
        e.storage()
            .instance()
            .set(&StorageKey::Proposal(proposal_id), &proposal);

        Ok(())
    }

    /// Finalize voting. Marks proposal as Passed or Defeated.
    /// Must be called after vote_end before queuing.
    pub fn finalize(e: Env, proposal_id: u32) -> Result<ProposalStatus, Error> {
        let mut proposal: Proposal = e
            .storage()
            .instance()
            .get(&StorageKey::Proposal(proposal_id))
            .ok_or(Error::ProposalNotFound)?;

        if proposal.status != ProposalStatus::Active {
            return Ok(proposal.status);
        }

        let current = e.ledger().sequence();
        if current <= proposal.vote_end {
            return Err(Error::VotingStillActive);
        }

        let config: TimelockConfig = e
            .storage()
            .instance()
            .get(&StorageKey::Config)
            .ok_or(Error::NotInitialized)?;

        let total_votes = proposal.votes_for + proposal.votes_against + proposal.votes_abstain;

        let new_status = if total_votes < config.quorum || proposal.votes_for <= proposal.votes_against {
            ProposalStatus::Defeated
        } else {
            ProposalStatus::Passed
        };

        proposal.status = new_status;
        e.storage()
            .instance()
            .set(&StorageKey::Proposal(proposal_id), &proposal);

        Ok(new_status)
    }

    /// Queue a passed proposal into the timelock.
    /// Starts the mandatory delay countdown.
    pub fn queue(e: Env, caller: Address, proposal_id: u32) -> Result<u32, Error> {
        caller.require_auth();
        Self::require_not_paused(&e)?;

        let mut proposal: Proposal = e
            .storage()
            .instance()
            .get(&StorageKey::Proposal(proposal_id))
            .ok_or(Error::ProposalNotFound)?;

        if proposal.status == ProposalStatus::Queued {
            return Err(Error::ProposalAlreadyQueued);
        }
        if proposal.status == ProposalStatus::Executed {
            return Err(Error::ProposalAlreadyExecuted);
        }
        if proposal.status == ProposalStatus::Cancelled {
            return Err(Error::ProposalAlreadyCancelled);
        }
        if proposal.status != ProposalStatus::Passed {
            return Err(Error::ProposalNotPassed);
        }

        let config: TimelockConfig = e
            .storage()
            .instance()
            .get(&StorageKey::Config)
            .ok_or(Error::NotInitialized)?;

        let current = e.ledger().sequence();
        let executable_at = current + config.timelock_delay;
        let expires_at = executable_at + config.execution_window;

        proposal.queued_at = current;
        proposal.executable_at = executable_at;
        proposal.expires_at = expires_at;
        proposal.status = ProposalStatus::Queued;

        e.storage()
            .instance()
            .set(&StorageKey::Proposal(proposal_id), &proposal);

        Ok(executable_at)
    }

    /// Execute a queued proposal after the timelock delay has elapsed.
    pub fn execute(e: Env, caller: Address, proposal_id: u32) -> Result<(), Error> {
        caller.require_auth();
        Self::require_not_paused(&e)?;

        let mut proposal: Proposal = e
            .storage()
            .instance()
            .get(&StorageKey::Proposal(proposal_id))
            .ok_or(Error::ProposalNotFound)?;

        if proposal.status == ProposalStatus::Executed {
            return Err(Error::ProposalAlreadyExecuted);
        }
        if proposal.status == ProposalStatus::Cancelled {
            return Err(Error::ProposalAlreadyCancelled);
        }
        if proposal.status != ProposalStatus::Queued {
            return Err(Error::ProposalNotQueued);
        }

        let current = e.ledger().sequence();

        if current < proposal.executable_at {
            return Err(Error::DelayNotElapsed);
        }
        if current > proposal.expires_at {
            proposal.status = ProposalStatus::Expired;
            e.storage()
                .instance()
                .set(&StorageKey::Proposal(proposal_id), &proposal);
            return Err(Error::ExecutionWindowExpired);
        }

        proposal.status = ProposalStatus::Executed;
        e.storage()
            .instance()
            .set(&StorageKey::Proposal(proposal_id), &proposal);

        Ok(())
    }

    /// Cancel a proposal. Admin or guardian only.
    /// Can cancel at any stage before execution.
    pub fn cancel(e: Env, caller: Address, proposal_id: u32) -> Result<(), Error> {
        caller.require_auth();

        let admin: Address = e
            .storage()
            .instance()
            .get(&StorageKey::Admin)
            .ok_or(Error::NotInitialized)?;
        let guardian: Address = e
            .storage()
            .instance()
            .get(&StorageKey::Guardian)
            .ok_or(Error::NotInitialized)?;

        if caller != admin && caller != guardian {
            return Err(Error::Unauthorized);
        }

        let mut proposal: Proposal = e
            .storage()
            .instance()
            .get(&StorageKey::Proposal(proposal_id))
            .ok_or(Error::ProposalNotFound)?;

        if proposal.status == ProposalStatus::Executed {
            return Err(Error::ProposalAlreadyExecuted);
        }
        if proposal.status == ProposalStatus::Cancelled {
            return Err(Error::ProposalAlreadyCancelled);
        }

        proposal.status = ProposalStatus::Cancelled;
        e.storage()
            .instance()
            .set(&StorageKey::Proposal(proposal_id), &proposal);

        Ok(())
    }

    /// Pause or unpause the timelock. Guardian only.
    pub fn set_paused(e: Env, caller: Address, paused: bool) -> Result<(), Error> {
        caller.require_auth();

        let guardian: Address = e
            .storage()
            .instance()
            .get(&StorageKey::Guardian)
            .ok_or(Error::NotInitialized)?;

        if caller != guardian {
            return Err(Error::Unauthorized);
        }

        let mut config: TimelockConfig = e
            .storage()
            .instance()
            .get(&StorageKey::Config)
            .ok_or(Error::NotInitialized)?;

        config.paused = paused;
        e.storage().instance().set(&StorageKey::Config, &config);

        Ok(())
    }

    /// Update timelock delay and execution window. Admin only.
    pub fn update_config(
        e: Env,
        caller: Address,
        timelock_delay: u32,
        execution_window: u32,
        quorum: u32,
        voting_period: u32,
    ) -> Result<(), Error> {
        caller.require_auth();

        let admin: Address = e
            .storage()
            .instance()
            .get(&StorageKey::Admin)
            .ok_or(Error::NotInitialized)?;

        if caller != admin {
            return Err(Error::Unauthorized);
        }
        if timelock_delay == 0 {
            return Err(Error::InvalidDelay);
        }
        if execution_window == 0 {
            return Err(Error::InvalidExecutionWindow);
        }

        let mut config: TimelockConfig = e
            .storage()
            .instance()
            .get(&StorageKey::Config)
            .ok_or(Error::NotInitialized)?;

        config.timelock_delay = timelock_delay;
        config.execution_window = execution_window;
        config.quorum = quorum;
        config.voting_period = voting_period;

        e.storage().instance().set(&StorageKey::Config, &config);

        Ok(())
    }

    /// Get a proposal by ID.
    pub fn get_proposal(e: Env, proposal_id: u32) -> Result<Proposal, Error> {
        e.storage()
            .instance()
            .get(&StorageKey::Proposal(proposal_id))
            .ok_or(Error::ProposalNotFound)
    }

    /// Get current config.
    pub fn get_config(e: Env) -> Result<TimelockConfig, Error> {
        e.storage()
            .instance()
            .get(&StorageKey::Config)
            .ok_or(Error::NotInitialized)
    }

    /// Check if an address has voted on a proposal.
    pub fn has_voted(e: Env, proposal_id: u32, voter: Address) -> bool {
        e.storage()
            .instance()
            .get(&StorageKey::HasVoted(proposal_id, voter))
            .unwrap_or(false)
    }

    /// Get total proposal count.
    pub fn proposal_count(e: Env) -> u32 {
        e.storage()
            .instance()
            .get(&StorageKey::ProposalCount)
            .unwrap_or(0)
    }

    /// Check if a proposal is currently executable.
    pub fn is_executable(e: Env, proposal_id: u32) -> bool {
        let proposal: Proposal = match e
            .storage()
            .instance()
            .get(&StorageKey::Proposal(proposal_id))
        {
            Some(p) => p,
            None => return false,
        };

        if proposal.status != ProposalStatus::Queued {
            return false;
        }

        let current = e.ledger().sequence();
        current >= proposal.executable_at && current <= proposal.expires_at
    }

    // --- Internal helpers ---

    fn require_not_paused(e: &Env) -> Result<(), Error> {
        let config: TimelockConfig = e
            .storage()
            .instance()
            .get(&StorageKey::Config)
            .ok_or(Error::NotInitialized)?;
        if config.paused {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }
}

#[cfg(test)]
mod test;
