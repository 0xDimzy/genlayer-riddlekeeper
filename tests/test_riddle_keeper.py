# tests/test_riddle_keeper.py
# Integration tests for RiddleKeeper.
#
# Modeled on tests/integration/icontracts/tests/test_wizard_of_coin.py,
# test_payable_escrow.py and test_faucet_eoa_transfer.py in
# genlayerlabs/genlayer-studio (main branch).
#
# REQUIRES the gltest harness (a `genlayer up` Studio environment):
# `gltest`, the `setup_validators` fixture and the mocked LLM responses
# only exist inside that harness. NOT runnable with plain pytest.
#
# To run inside a genlayer-studio checkout, copy
# contracts/riddle_keeper.py to
# tests/integration/icontracts/contracts/riddle_keeper.py and run the
# icontracts suite, or pass the workspace path as contract_file_path.
#
# Mock notes (read before editing):
# - The "response" mapping key ("wizard") mirrors test_wizard_of_coin.py:
#   it is the mocked LLM/model id configured in that harness. If your
#   harness configures a different model id, change the key to match.
# - The "eq_principle_prompt_comparative" dict key MUST match exactly the
#   criteria string passed to gl.eq_principle.prompt_comparative in the
#   contract: "The value of correct has to match".

import json

from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded
from gltest.types import TransactionStatus

RIDDLE = "I speak without a mouth and hear without ears. I have no body, but I come alive with wind. What am I?"
CRITERIA = "The answer must be 'echo' (or a word meaning a reflected sound that repeats what it hears)."
RIDDLE_2 = "The more of me you take, the more you leave behind. What am I?"
CRITERIA_2 = "The answer must be 'footsteps' (or a word meaning the marks left behind by walking)."
STAKE = 100
MAX_ATTEMPTS = 3


def _mock_judgement(correct: bool):
    return {
        "response": {
            "wizard": json.dumps(
                {
                    "reasoning": "Judged strictly against the public criteria.",
                    "correct": correct,
                }
            ),
        },
        "eq_principle_prompt_comparative": {
            "The value of correct has to match": True,
        },
    }


def _deploy():
    factory = get_contract_factory(
        contract_file_path="tests/integration/icontracts/contracts/riddle_keeper.py"
    )
    return factory.deploy(args=[RIDDLE, CRITERIA, STAKE, MAX_ATTEMPTS])


def _winner_address(contract):
    # The test harness deploys and calls from a default account whose
    # address the test does not know in advance; read it back from the
    # leaderboard instead of hardcoding it.
    board = contract.get_leaderboard(args=[]).call()
    assert len(board) == 1
    return next(iter(board))


def test_deploy_and_initial_state(setup_validators):
    setup_validators()
    contract = _deploy()

    assert contract.get_riddle(args=[]).call() == RIDDLE
    assert contract.get_solution_criteria(args=[]).call() == CRITERIA
    assert contract.get_round(args=[]).call() == 1
    assert contract.get_prize_pool(args=[]).call() == 0
    assert contract.get_stake_amount(args=[]).call() == STAKE
    assert contract.get_max_attempts(args=[]).call() == MAX_ATTEMPTS
    assert contract.get_contract_balance(args=[]).call() == 0
    # Keeper and coin holder are hex addresses (keeper holds the coin).
    assert contract.get_keeper(args=[]).call().startswith("0x")
    assert contract.get_coin_holder(args=[]).call() == contract.get_keeper(args=[]).call()


def test_wrong_answer_joins_pool(setup_validators):
    setup_validators(_mock_judgement(correct=False))
    contract = _deploy()

    tx = contract.attempt(args=["banana"]).transact(
        value=STAKE,
        wait_transaction_status=TransactionStatus.FINALIZED,
    )
    assert tx_execution_succeeded(tx)

    assert contract.get_prize_pool(args=[]).call() == STAKE
    assert contract.get_round(args=[]).call() == 1
    assert contract.get_riddle(args=[]).call() == RIDDLE
    # A wrong answer earns no points, so the leaderboard stays empty.
    assert contract.get_leaderboard(args=[]).call() == {}


def test_correct_answer_wins_round(setup_validators):
    setup_validators(_mock_judgement(correct=True))
    contract = _deploy()

    tx = contract.attempt(args=["echo"]).transact(
        value=STAKE,
        wait_transaction_status=TransactionStatus.FINALIZED,
    )
    assert tx_execution_succeeded(tx)

    player = _winner_address(contract)
    # Winner takes the (empty) pool plus their own stake back.
    assert contract.get_winnings(args=[player]).call() == STAKE
    assert contract.get_wins(args=[player]).call() == 1
    assert contract.get_points(args=[player]).call() == 100
    assert contract.get_coin_holder(args=[]).call() == player
    assert contract.get_round(args=[]).call() == 2
    # Riddle cleared: no attempts possible until the keeper sets a new one.
    assert contract.get_riddle(args=[]).call() == ""
    assert contract.get_prize_pool(args=[]).call() == 0


def test_attempt_limit_per_round(setup_validators):
    setup_validators(_mock_judgement(correct=False))
    factory = get_contract_factory(
        contract_file_path="tests/integration/icontracts/contracts/riddle_keeper.py"
    )
    contract = factory.deploy(args=[RIDDLE, CRITERIA, STAKE, 1])

    tx1 = contract.attempt(args=["banana"]).transact(
        value=STAKE,
        wait_transaction_status=TransactionStatus.FINALIZED,
    )
    assert tx_execution_succeeded(tx1)

    # Second attempt in the same round must fail (max 1 attempt).
    tx2 = contract.attempt(args=["also wrong"]).transact(
        value=STAKE,
        wait_transaction_status=TransactionStatus.FINALIZED,
    )
    assert not tx_execution_succeeded(tx2)


def test_keeper_cannot_play(setup_validators):
    # The deployer is the keeper, and the harness calls from the same
    # default account, so this attempt must be rejected.
    setup_validators(_mock_judgement(correct=True))
    contract = _deploy()

    tx = contract.attempt(args=["echo"]).transact(
        value=STAKE,
        wait_transaction_status=TransactionStatus.FINALIZED,
    )
    assert not tx_execution_succeeded(tx)


def test_set_riddle_after_win_and_claim(setup_validators):
    setup_validators(_mock_judgement(correct=True))
    contract = _deploy()

    tx = contract.attempt(args=["echo"]).transact(
        value=STAKE,
        wait_transaction_status=TransactionStatus.FINALIZED,
    )
    assert tx_execution_succeeded(tx)
    player = _winner_address(contract)

    # Keeper sets the next riddle (round 2).
    tx = contract.set_riddle(args=[RIDDLE_2, CRITERIA_2]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED,
    )
    assert tx_execution_succeeded(tx)
    assert contract.get_riddle(args=[]).call() == RIDDLE_2

    # Winner claims: real GEN transfer out of the contract balance
    # (emit_transfer), settled on finalization.
    tx = contract.claim_winnings(args=[]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED,
        wait_triggered_transactions=True,
        wait_triggered_transactions_status=TransactionStatus.FINALIZED,
    )
    assert tx_execution_succeeded(tx)
    assert contract.get_winnings(args=[player]).call() == 0
    assert contract.get_claimed(args=[player]).call() == STAKE
    assert contract.get_contract_balance(args=[]).call() == 0

    # Nothing left to claim.
    tx = contract.claim_winnings(args=[]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED,
    )
    assert not tx_execution_succeeded(tx)
