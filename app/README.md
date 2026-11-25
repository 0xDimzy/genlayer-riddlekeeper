# RiddleKeeper dApp

Playable frontend for the RiddleKeeper Intelligent Contract on GenLayer
Studionet. The contract is a consensus-judged riddle game with GEN
staking — see `../README.md` for the contract design and the verified
live test results.

> **Studionet testnet — GEN has no monetary value.** Every number on
> screen is read live from the deployed contract; nothing is mocked.

## Live deployment

- Contract: `0x16A84c3e070b89405ffE2bfAE9c4C8Fe8b88ac7a` (Studionet, chain 61999)
- Deploy tx: `0x8a547fd5a234ccbaecd940432a45d0737ab2659adc670c19b27ee093063ecb04`
- Studio: https://studio.genlayer.com/?import-contract=0x16A84c3e070b89405ffE2bfAE9c4C8Fe8b88ac7a
- Explorer: https://explorer-studio.genlayer.com/address/0x16a84c3e070b89405ffe2bfae9c4c8fe8b88ac7a
- Keeper at deploy: `0xD7Cc6ed137a5f05bf6A6B6591Ea7b99237abb48a` (a
  Studio-managed local account — see the keeper note below)

## How it talks to the contract

The official **GenLayerJS SDK** (`genlayer-js` v1.1.8, TypeScript over
Viem), exactly as the official boilerplate does it
([genlayer-project-boilerplate](https://github.com/genlayerlabs/genlayer-project-boilerplate),
`frontend/lib/`):

| Piece | What the app does |
| --- | --- |
| Client | `createClient({ chain: studionet, account?, endpoint: "https://studio.genlayer.com/api" })` from `genlayer-js` / `genlayer-js/chains` (`src/genlayer/client.ts`) |
| Reads | `client.readContract({ address, functionName, args })` — public view methods, no account, no fee (`src/genlayer/riddlekeeper.ts`) |
| Writes | `client.writeContract({ address, functionName, args, value, fees })` then `client.waitForTransactionReceipt({ hash, status: "ACCEPTED", retries: 24, interval: 5000 })` |
| Fees | Protocol-fee preset estimated first via `estimateTransactionFees` (+ `simulateWriteContract` / `estimateTransactionFeesFromSimulation` when available) — on fee-policy chains `writeContract` rejects a call without `fees` (`src/genlayer/fees.ts`, same shape as the boilerplate) |
| Wallet | MetaMask via `window.ethereum` (EIP-1193): `eth_requestAccounts`, `wallet_switchEthereumChain` / `wallet_addEthereumChain` for Studionet (chain 61999, `0xF22F`). The SDK signs through `window.ethereum` when an account is set — it has no custom-transport support |

Docs used (fetched 2026-11-26):

- https://docs.genlayer.com/developers/decentralized-applications/genlayer-js
  (GenLayerJS SDK overview)
- https://docs.genlayer.com/developers/decentralized-applications/reading-data
  (reads: public view methods, no fee/signing; `kwargs` vs `args`,
  `LATEST_FINAL` snapshots)
- https://docs.genlayer.com/api-references/genlayer-node/gen/gen_call
  (`gen_call` RPC: reads without creating a transaction)
- https://docs.genlayer.com/understand-genlayer-protocol/core-concepts/transactions/transaction-encoding-serialization-and-signing
  (outer EVM tx + GenLayer consensus tx; "use GenLayerJS write calls…
  instead of constructing consensus calldata by hand")
- SDK source: https://github.com/genlayerlabs/genlayer-js
  (`src/chains/studionet.ts`: chain 61999, RPC
  `https://studio.genlayer.com/api`, `isStudio: true`)

No GenLayer API was invented: every SDK call above is copied from the
docs/boilerplate/SDK source listed here.

## What the app does

- **Game state (no wallet needed):** live riddle + public solution
  criteria, round, prize pool, coin holder, stake required, attempts
  per round, contract balance — refreshed on load, every 20 s, and on
  demand.
- **Play:** connect MetaMask (Studionet), submit an answer with a GEN
  stake (default 100 GEN, the value used in the verified live test).
  Validators judge the answer against the public criteria via the
  Equivalence Principle; a correct answer wins the pool + stake, +100
  points, and advances the round. Your per-round attempts are shown.
- **Claim:** a claim card appears only when the connected wallet has
  unclaimed winnings (`get_winnings > 0`). Claiming is a real GEN
  transfer from the contract.
- **Leaderboard:** `get_leaderboard` (points map) + `get_wins` per
  player, sorted by points. The current coin holder is crowned 👑.
- **Keeper panel:** appears only when the connected wallet is the
  keeper (`get_keeper()`). The keeper sets the next riddle after a
  round is won (only possible while no riddle is active).

### Keeper note (honest limitation)

The deployed keeper is a **Studio-managed local account**
(`0xD7Cc…b48a`) — it was the deployer because the portal wallet had 0
GEN on Studionet and the Studio faucet would not fund an external
wallet in that session (see `../README.md`). That account cannot sign
from MetaMask, so for *this* deployment the keeper sets riddles from
Studio Run & Debug, and the in-app keeper panel is functional code
that activates only if a keeper wallet is ever connected. The game
itself (play / claim / leaderboard) works fully from any MetaMask
wallet holding Studionet GEN.

### Attempts counter note

The contract resets a player's attempt counter on their first
`attempt()` of a new round (see `attempts_round` in the contract).
There is no `get_attempts_round` view, so after a round advances the
displayed count can still show the previous round's value until that
player attempts once. The app says this on screen rather than
inventing a value.

## Run locally

```bash
cd app
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc + vite build -> dist/
npm run preview    # serve dist/ on http://localhost:4173
npm run verify:live  # same SDK reads as the app, asserts live values
```

Copy `.env.example` to `.env` to override the RPC URL, chain, or
contract address (defaults already point at the live Studionet
deployment).

## Known blocker — live reads fail from headless clients (2026-11-26)

**Status: the app is built correctly, but its live reads cannot be
verified from this environment.** `npm run verify:live` (the exact
`genlayer-js` read calls the app makes) FAILS with exit 1:

```
GenLayer RPC error (gen_call): execution failed
LIVE READ FAILED: Missing or invalid parameters.
GenVM result: \x02malformed_entry
```

RPC `-32000`, `execution_result: "ERROR"`, `gas_used: 0`. The node
returns the contract's real state in the receipt (including the
round-2 "footsteps" riddle text), so it finds the contract — then
GenVM rejects the call.

**Everything on the call side was ruled out (all tested 2026-11-26,
all fail identically):**

- SDK `genlayer-js` 1.1.8 (same version the Studio UI uses) and 1.2.0
- `gen_call` and `sim_call` (raw `client.request`); `latest-nonfinal`
  and `latest-final` variants; `from` = zero address and the winner
  account `0x57FDF9…c133`
- `x-session-id` header (fresh `ws-<timestamp>`, same shape the
  Studio UI sends) and no header
- hand-built calldata: 4 outer wrappings (SDK shape
  `RLP([inner, 0x00])`, `RLP([inner])`, raw inner, `RLP([inner, 0x01])`
  leaderOnly=true) × 5 inner shapes (`{method}`,
  `{args: [], method}`, `{args: {}, method}`, `{method, kwargs: {}}`,
  `{args: [], kwargs: {}, method}`) — every method, including no-arg
  reads (`get_riddle`, `get_round`, `get_coin_holder`, …)
- the inner calldata decodes cleanly by the SDK's own varint TLV
  scheme, and the echo-server capture proves the SDK sends exactly
  what the docs describe

**What DOES work against the same endpoint:** `getContractSchema`
(returns the correct v0.4.0 schema) and `getContractCode` (returns the
deployed source). The Studio UI reads the same contract fine in a
browser (Run & Debug) — it uses the same SDK 1.1.8, the same RPC URL
(`https://studio.genlayer.com/api`, confirmed in the hosted Studio's
`/runtime-config.js`), the same chain (61999), and the same
`callReadMethod` path. The difference is server-side: the bare `/api`
node's GenVM rejects execution of this v0.4.0 contract while the
session simulator's GenVM (v0.4.0-rc1) runs it. No app-side change can
fix that — the app already makes the exact documented calls.

**The app handles this honestly:** a failed read shows the error on
screen (`loadError` card in `src/App.tsx`), never a placeholder value.
The numbers below are the values verified earlier in Studio Run &
Debug (browser session), NOT values read by the SDK from this
environment — the app will display them live once the backend accepts
its calls.

**Next steps, in order:**

1. **Verify from a real browser** (needs a browser session — not
   available to this agent): open the served app in Chrome and check
   whether the reads return the values below. If yes, the blocker is
   headless-only and the app is done as-is.
2. **If reads fail in-browser too:** deploy RiddleKeeper on Bradbury
   testnet (chain 4221, the real Go node the docs/boilerplate target),
   replay the round-2 state, and point the app at that deployment
   (needs a Bradbury-funded wallet + faucet claim — a user decision).

## Verified 2026-11-26

- `npm run build` passes (tsc + vite, exit 0); `dist/` is a static
  site served by `npm run preview` (index 200, JS bundle 200,
  713 KB). Build fixes applied this session: `tsconfig.json` now pins
  `"types": ["react", "react-dom"]` (the earlier install left empty
  `@types/babel__*` / `@types/prop-types` dirs that broke `tsc`),
  `src/vite-env.d.ts` added for `import.meta.env`, unused import
  removed, `CalldataEncodable` typing fixed in `riddlekeeper.ts`.
- `npm run verify:live` FAILS (exit 1) — see the blocker above. It
  now fails cleanly with the GenVM diagnosis instead of an uncaught
  stack trace.
- Values verified earlier in Studio Run & Debug (browser session,
  all tx FINALIZED — see `../README.md`): riddle is the round-2
  "footsteps" riddle, round = 2, prize pool = 0 GEN, coin holder =
  `0x57FDF9…c133`, keeper = `0xD7Cc…b48a`, winner winnings = 0
  (claimed), winner claimed = 200 GEN, winner points = 100, wins =
  1, leaderboard contains the winner at 100 points.
- Not verified in this environment: clicking through the UI in a real
  browser with MetaMask (no live browser here) — the write path uses
  the same SDK calls the official boilerplate uses, and the same calls
  were exercised end-to-end in Studio Run & Debug during the live test
  (deploy, wrong answer, correct answer, claim, set riddle — all
  FINALIZED; see `../README.md`).
