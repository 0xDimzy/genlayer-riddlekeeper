# RiddleKeeper — "The Riddlekeeper's Coin"

An original GenLayer Intelligent Contract: a consensus-judged riddle game
with staking. Built for the GenLayer Points **Intelligent Contracts**
mission (submit a reusable contract primitive, not a demo).

> **Not a fork.** The Studio template `wizard_of_coin.py` is a single
> boolean flag (`have_coin`) flipped by an LLM that is told never to give
> the coin away. RiddleKeeper is a different game with different state and
> different economics: public riddles judged against public criteria,
> per-round attempt limits, a prize pool funded by wrong answers, a
> persistent points/wins leaderboard, and real GEN payouts. The only
> things shared with the template are the GenLayer API idioms every
> contract in the repo uses (`prompt_comparative`, `exec_prompt`,
> `write.payable`, the `_Recipient` transfer pattern).

## What it does

1. The **keeper** (deployer) sets a riddle plus **public solution
   criteria** — e.g. riddle *"I speak without a mouth…"*, criteria *"The
   answer must be 'echo' (or a word meaning a reflected sound…)"*.
2. Any player (except the keeper) stakes GEN and submits an answer with
   `attempt(answer)`.
3. Validators judge the answer against the **public criteria** through the
   Equivalence Principle. If correct, the player takes the coin, wins the
   prize pool plus their stake back, scores 100 points, and the round
   ends. If wrong, their stake joins the pool and their attempt is spent.
4. The keeper sets the next riddle; the game continues round after round.
   Winnings are claimed with `claim_winnings()` as a real GEN transfer.

## Why there is no stored answer (the anti-cheat design)

Contract state is readable by every validator — and by every player.
Storing the plaintext answer on-chain would let anyone read it and copy
it. So RiddleKeeper **never stores an answer**. Validators judge each
submitted answer against the *public criteria* only, via
`gl.eq_principle.prompt_comparative` with a strict JSON-only prompt
(`{"reasoning": str, "correct": bool}`). The criteria are public, the
answer is not stored anywhere, and correctness is decided by validator
consensus, not by a string comparison. This is the contract's actual
consensus logic — not a wrapper around a single LLM call: the judge's
verdict only counts if validators agree on the `correct` value.

## State design

| Field | Type | Meaning |
| --- | --- | --- |
| `riddle` / `solution_criteria` | `str` | Active riddle + public judging criteria. Cleared (`""`) when a round is won, so no attempts are possible until the keeper sets the next one. |
| `keeper` | `Address` | Deployer (`gl.message.sender_address` in `__init__`). Only the keeper can `set_riddle`, and the keeper cannot play. |
| `coin_holder` | `Address` | Title holder: keeper at deploy, round winner afterwards. Always exactly one holder — there is no un-held state. |
| `prize_pool` | `u256` | Stakes of wrong answers, paid out to the next winner. |
| `round` | `u256` | Starts at 1, increments on every win. |
| `stake_amount` / `max_attempts_per_round` | `u256` | Constructor parameters. |
| `attempts` / `attempts_round` | `TreeMap[Address, u256]` | Attempts used, and the round they were counted in — attempts reset automatically each round. |
| `wins` / `points` | `TreeMap[Address, u256]` | Wins and points (100 per win) per player. |
| `winnings` / `claimed` | `TreeMap[Address, u256]` | Unclaimed winnings and lifetime claimed amounts per player. |

Views: `get_riddle`, `get_solution_criteria`, `get_keeper`,
`get_coin_holder`, `get_prize_pool`, `get_round`, `get_stake_amount`,
`get_max_attempts`, `get_attempts(address)`, `get_wins(address)`,
`get_points(address)`, `get_winnings(address)`, `get_claimed(address)`,
`get_leaderboard` (full points map), `get_contract_balance`.

## Deploy in GenLayer Studio

1. Open https://studio.genlayer.com → **Contracts**.
2. Create a new contract and paste in `contracts/riddle_keeper.py`.
3. Fill in **Constructor Inputs** (detected from `__init__`):
   - `initial_riddle` — e.g. *"I speak without a mouth and hear without ears. I have no body, but I come alive with wind. What am I?"*
   - `solution_criteria` — e.g. *"The answer must be 'echo' (or a word meaning a reflected sound that repeats what it hears)."*
   - `stake_amount` — e.g. `100` (in wei of GEN on the target network; pick a small test value on Studionet)
   - `max_attempts_per_round` — e.g. `3`
4. Click **Deploy** on **Studionet** (Chain ID 61999, free sandbox; use the
   💧 button in the account selector for test GEN). No gas is charged in
   Studio.
5. Play in **Run & Debug**: `attempt` is payable (send ≥ `stake_amount`),
   `set_riddle` after a win, `claim_winnings` to pay out.
6. For the Bradbury testnet (Chain ID 4221, real GEN from the faucet),
   follow the docs' recommended flow: Studionet → Localnet → Bradbury.

## How to play

- **Keeper:** deploy with a riddle + criteria → after each win, call
  `set_riddle(new riddle, new criteria)`.
- **Player:** call `attempt(answer)` with value ≥ `stake_amount`. Wrong
  answer: stake joins `prize_pool`, one attempt spent (max
  `max_attempts_per_round` per round). Right answer: you become
  `coin_holder`, `winnings` += pool + your stake, +1 win, +100 points,
  round advances, riddle clears.
- **Winner:** call `claim_winnings()` to receive the GEN (see the note
  below).

## claim_winnings — honest note (Studio vs Bradbury)

`claim_winnings()` performs a **real GEN transfer** using the exact
`_Recipient` / `emit_transfer(value=...)` pattern from the repo's own
`faucet.py` and the GenLayer value-transfers docs: the value comes from
this contract's balance and settles on finalization. The ledger is
updated only *after* the transfer message is emitted, so a failed
emission reverts the whole call and no winnings are lost.

Caveat: **GenLayer Studio's sandbox states it does not support token
transfers.** In Studio, `claim_winnings()` may fail at the transfer step
(the winnings stay safely in the ledger, readable via `get_winnings`).
Verify the payout on **Bradbury** (or in the `gltest` harness — see
`test_set_riddle_after_win_and_claim` in `tests/test_riddle_keeper.py`,
which asserts the transfer end-to-end following
`test_faucet_eoa_transfer.py`). The winnings ledger itself works
identically on every network.

## Tests

- `tests/test_riddle_keeper.py` — integration tests modeled on the
  repo's `test_wizard_of_coin.py`, `test_payable_escrow.py`, and
  `test_faucet_eoa_transfer.py`. Requires the `gltest` harness
  (`genlayer up`); not runnable with plain pytest. Covers: deploy +
  initial state, wrong answer → pool, correct answer → win/round
  advance, per-round attempt limit, keeper cannot play, set next riddle
  after a win, and claim (real transfer, balance drained, second claim
  rejected).
- `tests/test_contract_static.py` — runnable locally with plain
  `python3` (stdlib only): `python3 tests/test_contract_static.py`.
  Verifies the file compiles, the header pins the verified py-genlayer
  hash, every designed method exists with the right decorator, all
  state fields are declared, and every `gl.*` call is from the
  confirmed API surface (no invented calls, no bare
  `gl.message.sender`, no plaintext-answer state field).

Verified 2026-11-26: `python3 -m py_compile` passes on all files and
`test_contract_static.py` reports **all checks passed** (exit 0).

## API surface — every call confirmed, with sources

All from `genlayerlabs/genlayer-studio` **main** (commit `c940729`) and
the GenLayer docs, fetched 2026-11-26:

| Call | Source |
| --- | --- |
| `# v0.3.0` + `Depends: py-genlayer:9b8kjy…9p0` | header of every example contract on main |
| `gl.contract.Contract`, `from genlayer.types import *` | `llm_erc20.py`, `tip_jar.py` |
| `gl.storage.TreeMap[Address, u256]`, `.get(key, 0)`, `.items()` | `llm_erc20.py` |
| `gl.message.sender_address` (`.as_hex`) | `tip_jar.py`, `llm_erc20.py` — note: the repo has no `gl.message.sender` |
| `gl.message.value` in `@gl.public.write.payable` | `faucet.py`, `tip_jar.py` |
| `gl.vm.UserError(...)` | `faucet.py`, `tip_jar.py` |
| `self.balance` | `tip_jar.py` (`get_balance`) |
| `gl.nondet.exec_prompt(prompt)` + `.replace("```json", "")` | `wizard_of_coin.py` |
| `gl.eq_principle.prompt_comparative(fn, "The value of X has to match")` | `wizard_of_coin.py` |
| `@gl.evm.contract_interface class _Recipient` + `emit_transfer(value=...)` | `faucet.py`; docs `developers/intelligent-contracts/features/value-transfers` ("The value comes from the emitting contract's balance") |
| `.transact(value=..., wait_transaction_status=FINALIZED, wait_triggered_transactions=True, ...)` + `assert (not) tx_execution_succeeded(tx)` | `test_payable_escrow.py`, `test_faucet_eoa_transfer.py` |

## Submission evidence (for the portal)

- GitHub repository containing this directory (readable source + this README).
- GenLayer Studio Contract / Explorer Contract link to the deployed contract.
- Notes (≤ 1000 chars): purpose, consensus use (equivalence-principle judging vs public criteria, no stored answer), state design, docs/tests.

## Files

```
contracts/riddle_keeper.py      # the contract
tests/test_riddle_keeper.py     # gltest integration tests (harness only)
tests/test_contract_static.py   # locally runnable static checks
README.md                       # this file
```
