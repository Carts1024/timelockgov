#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Bytes, Env,
};

fn setup() -> (Env, Address, Address, Address) {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().with_mut(|l| l.sequence_number = 100);

    let admin = Address::generate(&e);
    let guardian = Address::generate(&e);
    let contract_id = e.register(TimelockGov, ());
    let client = TimelockGovClient::new(&e, &contract_id);

    // timelock_delay: 50 ledgers, execution_window: 100 ledgers
    // quorum: 2 votes, voting_period: 20 ledgers
    client.initialize(
        &admin,
        &guardian,
        &50u32,
        &100u32,
        &2u32,
        &20u32,
    );

    (e, contract_id, admin, guardian)
}

fn make_proposal(e: &Env, contract_id: &Address, proposer: &Address) -> u32 {
    let client = TimelockGovClient::new(e, contract_id);
    client.propose(
        proposer,
        &Bytes::from_slice(e, b"Upgrade treasury cap"),
        &Bytes::from_slice(
            e,
            b"Increase the max withdrawal cap from 1000 to 5000",
        ),
    )
}

fn pass_proposal(e: &Env, contract_id: &Address, proposal_id: u32) {
    let client = TimelockGovClient::new(e, contract_id);
    let voter_a = Address::generate(e);
    let voter_b = Address::generate(e);
    let voter_c = Address::generate(e);

    // Vote for with 3 votes (quorum = 2)
    client.vote(&voter_a, &proposal_id, &1u32);
    client.vote(&voter_b, &proposal_id, &1u32);
    client.vote(&voter_c, &proposal_id, &1u32);

    // Advance past vote_end
    e.ledger().with_mut(|l| l.sequence_number += 21);

    // Finalize
    client.finalize(&proposal_id);
}

#[test]
fn test_initialize() {
    let (e, contract_id, _, _) = setup();
    let client = TimelockGovClient::new(&e, &contract_id);

    let config = client.get_config();
    assert_eq!(config.timelock_delay, 50);
    assert_eq!(config.execution_window, 100);
    assert_eq!(config.quorum, 2);
    assert_eq!(config.voting_period, 20);
    assert!(!config.paused);
}

#[test]
fn test_double_initialize_rejected() {
    let (e, contract_id, admin, guardian) = setup();
    let client = TimelockGovClient::new(&e, &contract_id);

    let result = client.try_initialize(
        &admin,
        &guardian,
        &50u32,
        &100u32,
        &2u32,
        &20u32,
    );
    assert!(result.is_err());
}

#[test]
fn test_propose() {
    let (e, contract_id, admin, _) = setup();
    let client = TimelockGovClient::new(&e, &contract_id);

    let id = make_proposal(&e, &contract_id, &admin);
    assert_eq!(id, 1);

    let proposal = client.get_proposal(&id);
    assert_eq!(proposal.status, ProposalStatus::Active);
    assert_eq!(proposal.votes_for, 0);
    assert_eq!(proposal.votes_against, 0);
}

#[test]
fn test_vote_for() {
    let (e, contract_id, admin, _) = setup();
    let client = TimelockGovClient::new(&e, &contract_id);

    let id = make_proposal(&e, &contract_id, &admin);
    let voter = Address::generate(&e);

    client.vote(&voter, &id, &1u32);

    let proposal = client.get_proposal(&id);
    assert_eq!(proposal.votes_for, 1);
    assert!(client.has_voted(&id, &voter));
}

#[test]
fn test_vote_against() {
    let (e, contract_id, admin, _) = setup();
    let client = TimelockGovClient::new(&e, &contract_id);

    let id = make_proposal(&e, &contract_id, &admin);
    let voter = Address::generate(&e);

    client.vote(&voter, &id, &0u32);

    let proposal = client.get_proposal(&id);
    assert_eq!(proposal.votes_against, 1);
}

#[test]
fn test_vote_abstain() {
    let (e, contract_id, admin, _) = setup();
    let client = TimelockGovClient::new(&e, &contract_id);

    let id = make_proposal(&e, &contract_id, &admin);
    let voter = Address::generate(&e);

    client.vote(&voter, &id, &2u32);

    let proposal = client.get_proposal(&id);
    assert_eq!(proposal.votes_abstain, 1);
}

#[test]
fn test_double_vote_rejected() {
    let (e, contract_id, admin, _) = setup();
    let client = TimelockGovClient::new(&e, &contract_id);

    let id = make_proposal(&e, &contract_id, &admin);
    let voter = Address::generate(&e);

    client.vote(&voter, &id, &1u32);

    let result = client.try_vote(&voter, &id, &1u32);
    assert!(result.is_err());
}

#[test]
fn test_finalize_passed() {
    let (e, contract_id, admin, _) = setup();
    let client = TimelockGovClient::new(&e, &contract_id);

    let id = make_proposal(&e, &contract_id, &admin);

    let voter_a = Address::generate(&e);
    let voter_b = Address::generate(&e);
    let voter_c = Address::generate(&e);
    client.vote(&voter_a, &id, &1u32);
    client.vote(&voter_b, &id, &1u32);
    client.vote(&voter_c, &id, &1u32);

    // Advance past vote_end
    e.ledger().with_mut(|l| l.sequence_number += 21);

    let status = client.finalize(&id);
    assert_eq!(status, ProposalStatus::Passed);
}

#[test]
fn test_finalize_defeated_quorum_not_met() {
    let (e, contract_id, admin, _) = setup();
    let client = TimelockGovClient::new(&e, &contract_id);

    let id = make_proposal(&e, &contract_id, &admin);

    // Only 1 vote — quorum is 2
    let voter = Address::generate(&e);
    client.vote(&voter, &id, &1u32);

    e.ledger().with_mut(|l| l.sequence_number += 21);

    let status = client.finalize(&id);
    assert_eq!(status, ProposalStatus::Defeated);
}

#[test]
fn test_finalize_defeated_votes_against_win() {
    let (e, contract_id, admin, _) = setup();
    let client = TimelockGovClient::new(&e, &contract_id);

    let id = make_proposal(&e, &contract_id, &admin);

    let voter_a = Address::generate(&e);
    let voter_b = Address::generate(&e);
    let voter_c = Address::generate(&e);
    client.vote(&voter_a, &id, &0u32); // against
    client.vote(&voter_b, &id, &0u32); // against
    client.vote(&voter_c, &id, &1u32); // for

    e.ledger().with_mut(|l| l.sequence_number += 21);

    let status = client.finalize(&id);
    assert_eq!(status, ProposalStatus::Defeated);
}

#[test]
fn test_queue_passed_proposal() {
    let (e, contract_id, admin, _) = setup();
    let client = TimelockGovClient::new(&e, &contract_id);

    let id = make_proposal(&e, &contract_id, &admin);
    pass_proposal(&e, &contract_id, id);

    let executable_at = client.queue(&admin, &id);
    let current = e.ledger().sequence();
    assert_eq!(executable_at, current + 50);

    let proposal = client.get_proposal(&id);
    assert_eq!(proposal.status, ProposalStatus::Queued);
}

#[test]
fn test_queue_not_passed_rejected() {
    let (e, contract_id, admin, _) = setup();
    let client = TimelockGovClient::new(&e, &contract_id);

    let id = make_proposal(&e, &contract_id, &admin);

    // Not finalized yet — still Active
    let result = client.try_queue(&admin, &id);
    assert!(result.is_err());
}

#[test]
fn test_execute_before_delay_rejected() {
    let (e, contract_id, admin, _) = setup();
    let client = TimelockGovClient::new(&e, &contract_id);

    let id = make_proposal(&e, &contract_id, &admin);
    pass_proposal(&e, &contract_id, id);
    client.queue(&admin, &id);

    // Try to execute immediately — delay not elapsed
    let result = client.try_execute(&admin, &id);
    assert!(result.is_err());
}

#[test]
fn test_execute_after_delay_succeeds() {
    let (e, contract_id, admin, _) = setup();
    let client = TimelockGovClient::new(&e, &contract_id);

    let id = make_proposal(&e, &contract_id, &admin);
    pass_proposal(&e, &contract_id, id);
    client.queue(&admin, &id);

    // Advance past timelock delay of 50 ledgers
    e.ledger().with_mut(|l| l.sequence_number += 51);

    client.execute(&admin, &id);

    let proposal = client.get_proposal(&id);
    assert_eq!(proposal.status, ProposalStatus::Executed);
}

#[test]
fn test_execute_after_window_expired() {
    let (e, contract_id, admin, _) = setup();
    let client = TimelockGovClient::new(&e, &contract_id);

    let id = make_proposal(&e, &contract_id, &admin);
    pass_proposal(&e, &contract_id, id);
    client.queue(&admin, &id);

    // Advance past timelock delay (50) + execution window (100)
    e.ledger().with_mut(|l| l.sequence_number += 200);

    // Call execute directly — it will set Expired then return the error
    // try_ rolls back state, so we use the non-try version inside a no-check call
    // and just verify the result is an error
    let result = client.try_execute(&admin, &id);
    assert!(result.is_err());

    // Since try_ rolls back, status remains Queued — just verify the error
    // The Expired transition only persists if called without try_
    let proposal = client.get_proposal(&id);
    assert_eq!(proposal.status, ProposalStatus::Queued);
}

#[test]
fn test_cancel_by_admin() {
    let (e, contract_id, admin, _) = setup();
    let client = TimelockGovClient::new(&e, &contract_id);

    let id = make_proposal(&e, &contract_id, &admin);
    pass_proposal(&e, &contract_id, id);
    client.queue(&admin, &id);

    client.cancel(&admin, &id);

    let proposal = client.get_proposal(&id);
    assert_eq!(proposal.status, ProposalStatus::Cancelled);
}

#[test]
fn test_cancel_by_guardian() {
    let (e, contract_id, admin, guardian) = setup();
    let client = TimelockGovClient::new(&e, &contract_id);

    let id = make_proposal(&e, &contract_id, &admin);
    pass_proposal(&e, &contract_id, id);
    client.queue(&admin, &id);

    client.cancel(&guardian, &id);

    let proposal = client.get_proposal(&id);
    assert_eq!(proposal.status, ProposalStatus::Cancelled);
}

#[test]
fn test_cancel_by_unauthorized_rejected() {
    let (e, contract_id, admin, _) = setup();
    let client = TimelockGovClient::new(&e, &contract_id);

    let id = make_proposal(&e, &contract_id, &admin);
    pass_proposal(&e, &contract_id, id);
    client.queue(&admin, &id);

    let rando = Address::generate(&e);
    let result = client.try_cancel(&rando, &id);
    assert!(result.is_err());
}

#[test]
fn test_execute_cancelled_rejected() {
    let (e, contract_id, admin, _) = setup();
    let client = TimelockGovClient::new(&e, &contract_id);

    let id = make_proposal(&e, &contract_id, &admin);
    pass_proposal(&e, &contract_id, id);
    client.queue(&admin, &id);
    client.cancel(&admin, &id);

    e.ledger().with_mut(|l| l.sequence_number += 51);

    let result = client.try_execute(&admin, &id);
    assert!(result.is_err());
}

#[test]
fn test_pause_blocks_propose() {
    let (e, contract_id, admin, guardian) = setup();
    let client = TimelockGovClient::new(&e, &contract_id);

    client.set_paused(&guardian, &true);

    let result = client.try_propose(
        &admin,
        &Bytes::from_slice(&e, b"Test proposal"),
        &Bytes::from_slice(&e, b"Description"),
    );
    assert!(result.is_err());
}

#[test]
fn test_pause_blocks_queue() {
    let (e, contract_id, admin, guardian) = setup();
    let client = TimelockGovClient::new(&e, &contract_id);

    let id = make_proposal(&e, &contract_id, &admin);
    pass_proposal(&e, &contract_id, id);

    client.set_paused(&guardian, &true);

    let result = client.try_queue(&admin, &id);
    assert!(result.is_err());
}

#[test]
fn test_pause_blocks_execute() {
    let (e, contract_id, admin, guardian) = setup();
    let client = TimelockGovClient::new(&e, &contract_id);

    let id = make_proposal(&e, &contract_id, &admin);
    pass_proposal(&e, &contract_id, id);
    client.queue(&admin, &id);

    client.set_paused(&guardian, &true);
    e.ledger().with_mut(|l| l.sequence_number += 51);

    let result = client.try_execute(&admin, &id);
    assert!(result.is_err());
}

#[test]
fn test_unpause_resumes_operations() {
    let (e, contract_id, admin, guardian) = setup();
    let client = TimelockGovClient::new(&e, &contract_id);

    client.set_paused(&guardian, &true);
    client.set_paused(&guardian, &false);

    // Should succeed after unpausing
    let id = make_proposal(&e, &contract_id, &admin);
    assert_eq!(id, 1);
}

#[test]
fn test_is_executable() {
    let (e, contract_id, admin, _) = setup();
    let client = TimelockGovClient::new(&e, &contract_id);

    let id = make_proposal(&e, &contract_id, &admin);
    pass_proposal(&e, &contract_id, id);
    client.queue(&admin, &id);

    // Not yet executable
    assert!(!client.is_executable(&id));

    // Advance past delay
    e.ledger().with_mut(|l| l.sequence_number += 51);
    assert!(client.is_executable(&id));

    // Advance past execution window
    e.ledger().with_mut(|l| l.sequence_number += 101);
    assert!(!client.is_executable(&id));
}

#[test]
fn test_update_config() {
    let (e, contract_id, admin, _) = setup();
    let client = TimelockGovClient::new(&e, &contract_id);

    client.update_config(&admin, &100u32, &200u32, &5u32, &30u32);

    let config = client.get_config();
    assert_eq!(config.timelock_delay, 100);
    assert_eq!(config.execution_window, 200);
    assert_eq!(config.quorum, 5);
    assert_eq!(config.voting_period, 30);
}

#[test]
fn test_update_config_unauthorized_rejected() {
    let (e, contract_id, _, _) = setup();
    let client = TimelockGovClient::new(&e, &contract_id);

    let rando = Address::generate(&e);
    let result = client.try_update_config(&rando, &100u32, &200u32, &5u32, &30u32);
    assert!(result.is_err());
}

#[test]
fn test_proposal_count_increments() {
    let (e, contract_id, admin, _) = setup();
    let client = TimelockGovClient::new(&e, &contract_id);

    make_proposal(&e, &contract_id, &admin);
    make_proposal(&e, &contract_id, &admin);
    make_proposal(&e, &contract_id, &admin);

    assert_eq!(client.proposal_count(), 3);
}

#[test]
fn test_full_lifecycle() {
    let (e, contract_id, admin, _) = setup();
    let client = TimelockGovClient::new(&e, &contract_id);

    // 1. Propose
    let id = make_proposal(&e, &contract_id, &admin);
    assert_eq!(client.get_proposal(&id).status, ProposalStatus::Active);

    // 2. Vote
    let voter_a = Address::generate(&e);
    let voter_b = Address::generate(&e);
    let voter_c = Address::generate(&e);
    client.vote(&voter_a, &id, &1u32);
    client.vote(&voter_b, &id, &1u32);
    client.vote(&voter_c, &id, &1u32);

    // 3. Finalize
    e.ledger().with_mut(|l| l.sequence_number += 21);
    client.finalize(&id);
    assert_eq!(client.get_proposal(&id).status, ProposalStatus::Passed);

    // 4. Queue
    client.queue(&admin, &id);
    assert_eq!(client.get_proposal(&id).status, ProposalStatus::Queued);

    // 5. Wait for delay
    e.ledger().with_mut(|l| l.sequence_number += 51);
    assert!(client.is_executable(&id));

    // 6. Execute
    client.execute(&admin, &id);
    assert_eq!(client.get_proposal(&id).status, ProposalStatus::Executed);
}
