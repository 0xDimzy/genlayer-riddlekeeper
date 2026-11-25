// Live-read verification for the RiddleKeeper dApp.
// Runs the SAME genlayer-js readContract calls the app makes against the
// deployed contract on Studionet and asserts the expected live values.
// Usage (from app/):  npm run verify:live
// Exit 0 = all values match the verified deployment state; exit 1 = mismatch.

import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const RPC_URL = "https://studio.genlayer.com/api";
const CONTRACT = "0x16A84c3e070b89405ffE2bfAE9c4C8Fe8b88ac7a";
const KEEPER = "0xd7cc6ed137a5f05bf6a6b6591ea7b99237abb48a";
const WINNER = "0x57fdf9ecb08f7d0982f9276279ae22eb2afdc133";
const EXPECTED_RIDDLE =
  "The more of me you take, the more you leave behind. What am I?";

const client = createClient({ chain: studionet, endpoint: RPC_URL });

async function read(fn, args = []) {
  return client.readContract({ address: CONTRACT, functionName: fn, args });
}

function fmtGen(wei) {
  const w = BigInt(wei);
  return `${(w / 10n ** 18n).toString()}.${(w % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "") || "0"}`;
}

const failures = [];
function check(name, actual, expected) {
  const ok =
    typeof expected === "function" ? expected(actual) : actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${String(actual)}`);
  if (!ok) failures.push(name);
}

let liveState;
try {
  liveState = await Promise.all([
    read("get_riddle"),
    read("get_solution_criteria"),
    read("get_keeper"),
    read("get_coin_holder"),
    read("get_prize_pool"),
    read("get_round"),
    read("get_stake_amount"),
    read("get_max_attempts"),
    read("get_contract_balance"),
    read("get_leaderboard"),
    read("get_winnings", [WINNER]),
    read("get_claimed", [WINNER]),
    read("get_points", [WINNER]),
    read("get_wins", [WINNER]),
  ]);
} catch (err) {
  // The Studionet /api node rejects gen_call/sim_call execution for this
  // contract from headless clients (RPC -32000 "execution failed",
  // GenVM result "malformed_entry") while getContractSchema/getContractCode
  // succeed and Studio Run & Debug reads the same contract fine in a
  // browser. This is a backend-side incompatibility, not an app bug:
  // the app makes the exact documented SDK calls. See app/README.md
  // ("Known blocker") for the full evidence and the next steps.
  const cause = err?.cause?.data?.receipt;
  console.error("LIVE READ FAILED:", err?.shortMessage || err?.message);
  if (cause?.result) {
    console.error(
      "GenVM result:",
      Buffer.from(cause.result, "base64").toString(),
    );
  }
  process.exit(1);
}
const [
  riddle,
  criteria,
  keeper,
  coinHolder,
  pool,
  round,
  stake,
  maxAttempts,
  balance,
  leaderboard,
  winnerWinnings,
  winnerClaimed,
  winnerPoints,
  winnerWins,
] = liveState;

console.log("--- RiddleKeeper live state (Studionet) ---");
console.log("contract:", CONTRACT);
console.log("solution criteria:", criteria);
console.log("prize pool:", `${pool} wei (${fmtGen(pool)} GEN)`);
console.log("stake amount:", `${stake} wei`);
console.log("max attempts:", String(maxAttempts));
console.log("contract balance:", `${balance} wei (${fmtGen(balance)} GEN)`);
console.log("winner winnings:", `${winnerWinnings} wei`);
console.log("winner claimed:", `${winnerClaimed} wei (${fmtGen(winnerClaimed)} GEN)`);
console.log("winner points:", String(winnerPoints));
console.log("winner wins:", String(winnerWins));
console.log(
  "leaderboard:",
  leaderboard instanceof Map
    ? JSON.stringify(Array.from(leaderboard.entries(), ([k, v]) => [k, String(v)]))
    : JSON.stringify(leaderboard),
);
console.log("-------------------------------------------");

check("riddle", riddle, EXPECTED_RIDDLE);
check("round", round, 2n);
check("prize pool", pool, 0n);
check("coin holder", String(coinHolder).toLowerCase(), WINNER);
check("keeper", String(keeper).toLowerCase(), KEEPER);
check("winner winnings (claimed, so 0)", winnerWinnings, 0n);
check("winner claimed (200 GEN)", winnerClaimed, 200n * 10n ** 18n);
check("winner points (100)", winnerPoints, 100n);
check("winner wins (1)", winnerWins, 1n);
check(
  "leaderboard has winner @ 100 pts",
  leaderboard,
  (lb) => {
    const entries =
      lb instanceof Map ? Array.from(lb.entries()) : Object.entries(lb ?? {});
    return entries.some(
      ([addr, pts]) =>
        String(addr).toLowerCase() === WINNER && BigInt(pts) === 100n,
    );
  },
);

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) FAILED: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nAll live-read checks passed.");
