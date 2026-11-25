# v0.4.0
# { "Depends": "py-genlayer:kzybg95x1gn21dw72m7hyg0maaap04n4nx55j9yt6fkdqxtz6bz0" }
import json

import genlayer as gl

from genlayer.types import *


@gl.evm.contract_interface
class _Recipient:
    class View:
        pass

    class Write:
        pass


class RiddleKeeper(gl.contract.Contract):
    # The active riddle and the PUBLIC criteria a correct answer must meet.
    # The plaintext answer is deliberately never stored on-chain: every
    # validator can read contract state, so a stored answer would be
    # copyable by any player. Judging happens against the criteria only.
    riddle: str
    solution_criteria: str

    # The deployer sets riddles; the coin is a title held by the keeper at
    # deploy and by the winner of each round afterwards.
    keeper: Address
    coin_holder: Address

    # Stakes of wrong answers accumulate here until someone wins the round.
    prize_pool: u256
    round: u256
    stake_amount: u256
    max_attempts_per_round: u256

    # Per-player ledgers. attempts_round records the round in which a
    # player's attempt counter was last (re)started, so attempts reset
    # automatically when a new round begins.
    attempts: gl.storage.TreeMap[Address, u256]
    attempts_round: gl.storage.TreeMap[Address, u256]
    wins: gl.storage.TreeMap[Address, u256]
    points: gl.storage.TreeMap[Address, u256]
    winnings: gl.storage.TreeMap[Address, u256]
    claimed: gl.storage.TreeMap[Address, u256]

    def __init__(
        self,
        initial_riddle: str,
        solution_criteria: str,
        stake_amount: u256,
        max_attempts_per_round: u256,
    ) -> None:
        if stake_amount == 0:
            raise gl.vm.UserError("stake_amount must be greater than 0")
        if max_attempts_per_round == 0:
            raise gl.vm.UserError("max_attempts_per_round must be greater than 0")
        self.riddle = initial_riddle
        self.solution_criteria = solution_criteria
        self.keeper = gl.message.sender_address
        self.coin_holder = gl.message.sender_address
        self.prize_pool = 0
        self.round = 1
        self.stake_amount = stake_amount
        self.max_attempts_per_round = max_attempts_per_round

    @gl.public.write.payable
    def attempt(self, answer: str) -> None:
        sender = gl.message.sender_address
        value = gl.message.value

        if self.riddle == "":
            raise gl.vm.UserError("no active riddle: wait for the keeper to set one")
        # The coin is always held by exactly one player (keeper at deploy,
        # round winner afterwards), so an active riddle implies the coin
        # is in play; there is no un-held state to guard against.
        if sender == self.keeper:
            raise gl.vm.UserError("the keeper already knows the riddle and cannot play")
        if answer == "":
            raise gl.vm.UserError("answer must not be empty")
        if value < self.stake_amount:
            raise gl.vm.UserError("stake too low: send at least stake_amount")

        # Attempts reset every round.
        if self.attempts_round.get(sender, 0) != self.round:
            self.attempts[sender] = 0
            self.attempts_round[sender] = self.round
        if self.attempts.get(sender, 0) >= self.max_attempts_per_round:
            raise gl.vm.UserError("no attempts left this round")

        # Precompute the judging prompt deterministically, before the
        # non-deterministic block (same pattern as llm_erc20).
        prompt = f"""
You are an impartial riddle judge. Judge ONLY against the public
solution criteria below. You do not know any hidden answer, and there
is no hidden answer to compare against.

Riddle: {self.riddle}

An answer is correct ONLY if it satisfies ALL of these public
solution criteria: {self.solution_criteria}

Submitted answer: {answer}

Be strict: a related word, a joke, or a partial match is NOT correct
unless it fully satisfies the criteria above.

Respond using ONLY the following format: {{
"reasoning": str,
"correct": bool
}}

It is mandatory that you respond only using the JSON format above,
nothing else. Don't include any other words or characters,
your output must be only JSON without any formatting prefix or suffix.
This result should be perfectly parsable by a JSON parser without errors.
"""

        def get_judgement() -> str:
            result = gl.nondet.exec_prompt(prompt)
            result = result.replace("```json", "").replace("```", "")
            print(result)
            return result

        result = gl.eq_principle.prompt_comparative(
            get_judgement, "The value of correct has to match"
        )
        parsed_result = json.loads(result)
        assert isinstance(parsed_result["correct"], bool)

        if parsed_result["correct"]:
            # Winner takes the pool plus their own stake back, takes the
            # coin, and the round ends. The riddle is cleared so no
            # attempts are possible until the keeper sets the next one.
            self.winnings[sender] = (
                self.winnings.get(sender, 0) + self.prize_pool + value
            )
            self.prize_pool = 0
            self.wins[sender] = self.wins.get(sender, 0) + 1
            self.points[sender] = self.points.get(sender, 0) + 100
            self.coin_holder = sender
            self.round = self.round + 1
            self.riddle = ""
            self.solution_criteria = ""
        else:
            self.attempts[sender] = self.attempts.get(sender, 0) + 1
            self.prize_pool = self.prize_pool + value

    @gl.public.write
    def set_riddle(self, riddle: str, solution_criteria: str) -> None:
        if gl.message.sender_address != self.keeper:
            raise gl.vm.UserError("only the keeper can set a riddle")
        if self.riddle != "":
            raise gl.vm.UserError("a riddle is already active")
        if riddle == "" or solution_criteria == "":
            raise gl.vm.UserError("riddle and solution criteria must not be empty")
        self.riddle = riddle
        self.solution_criteria = solution_criteria

    @gl.public.write
    def claim_winnings(self) -> None:
        sender = gl.message.sender_address
        amount = self.winnings.get(sender, 0)
        if amount == 0:
            raise gl.vm.UserError("nothing to claim")
        # Real GEN transfer out of this contract's balance (same
        # _Recipient / emit_transfer pattern as the faucet example; the
        # value comes from the emitting contract's balance and settles
        # on finalization). The ledger is updated only after the
        # transfer message is emitted, so a failed emission reverts the
        # whole call and no winnings are lost from the ledger.
        _Recipient(sender).emit_transfer(value=amount)
        self.winnings[sender] = 0
        self.claimed[sender] = self.claimed.get(sender, 0) + amount

    @gl.public.view
    def get_riddle(self) -> str:
        return self.riddle

    @gl.public.view
    def get_solution_criteria(self) -> str:
        return self.solution_criteria

    @gl.public.view
    def get_keeper(self) -> str:
        return str(self.keeper.as_hex)

    @gl.public.view
    def get_coin_holder(self) -> str:
        return str(self.coin_holder.as_hex)

    @gl.public.view
    def get_prize_pool(self) -> u256:
        return self.prize_pool

    @gl.public.view
    def get_round(self) -> u256:
        return self.round

    @gl.public.view
    def get_stake_amount(self) -> u256:
        return self.stake_amount

    @gl.public.view
    def get_max_attempts(self) -> u256:
        return self.max_attempts_per_round

    @gl.public.view
    def get_attempts(self, address: str) -> u256:
        return self.attempts.get(Address(address), 0)

    @gl.public.view
    def get_wins(self, address: str) -> u256:
        return self.wins.get(Address(address), 0)

    @gl.public.view
    def get_points(self, address: str) -> u256:
        return self.points.get(Address(address), 0)

    @gl.public.view
    def get_winnings(self, address: str) -> u256:
        return self.winnings.get(Address(address), 0)

    @gl.public.view
    def get_claimed(self, address: str) -> u256:
        return self.claimed.get(Address(address), 0)

    @gl.public.view
    def get_leaderboard(self) -> dict[str, int]:
        return {k.as_hex: v for k, v in self.points.items()}

    @gl.public.view
    def get_contract_balance(self) -> u256:
        return self.balance
