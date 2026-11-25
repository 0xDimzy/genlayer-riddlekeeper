// TypeScript wrapper around the deployed RiddleKeeper contract.
// Reads go through genlayer-js readContract (public view methods need no
// account and no fee). Writes go through writeContract + wait for the
// ACCEPTED receipt, with a protocol-fee preset estimated first — the same
// flow as the official boilerplate's FootballBets class.

import { CONTRACT_ADDRESS } from "./config";
import type { GenLayerClient } from "./client";
import type { CalldataEncodable } from "genlayer-js/types";
import {
  estimateWriteFeePreset,
  feePresetToTransactionFees,
  type FeePresetEstimate,
} from "./fees";

export interface GameState {
  riddle: string;
  solutionCriteria: string;
  keeper: string;
  coinHolder: string;
  prizePool: bigint;
  round: bigint;
  stakeAmount: bigint;
  maxAttempts: bigint;
  contractBalance: bigint;
}

export interface PlayerState {
  attempts: bigint;
  wins: bigint;
  points: bigint;
  winnings: bigint;
  claimed: bigint;
}

export interface LeaderboardEntry {
  address: string;
  points: bigint;
  wins: bigint;
}

export interface TxResult {
  hash: string;
  status: string;
}

function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  throw new Error(`cannot convert ${String(value)} to bigint`);
}

function toStringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

/** Decode a GenLayer dict return (Map) or plain object into entries. */
function mapEntries(
  value: unknown,
): Array<[string, unknown]> {
  if (value instanceof Map) return Array.from(value.entries());
  if (value && typeof value === "object") return Object.entries(value);
  return [];
}

export class RiddleKeeper {
  private client: GenLayerClient;
  private address: `0x${string}`;

  constructor(client: GenLayerClient, address: string = CONTRACT_ADDRESS) {
    this.client = client;
    this.address = address as `0x${string}`;
  }

  private async read(
    functionName: string,
    args: CalldataEncodable[] = [],
  ): Promise<unknown> {
    return this.client.readContract({
      address: this.address,
      functionName,
      args,
    });
  }

  private async write(
    functionName: string,
    args: CalldataEncodable[],
    value: bigint,
  ): Promise<TxResult> {
    const feePreset: FeePresetEstimate | undefined =
      await estimateWriteFeePreset(
        this.client as unknown as Parameters<
          typeof estimateWriteFeePreset
        >[0],
        {
          address: this.address,
          functionName,
          args,
          value,
        },
      );
    const fees = feePresetToTransactionFees(feePreset);
    const hash = (await this.client.writeContract({
      address: this.address,
      functionName,
      args,
      value,
      ...(fees ? { fees } : {}),
    })) as string;
    const receipt = (await this.client.waitForTransactionReceipt({
      hash: hash as `0x${string}`,
      status: "ACCEPTED",
      retries: 24,
      interval: 5000,
    } as Parameters<GenLayerClient["waitForTransactionReceipt"]>[0])) as {
      status?: string;
    };
    return { hash, status: receipt?.status ?? "unknown" };
  }

  /** All public game state in parallel — every value from live reads. */
  async getGameState(): Promise<GameState> {
    const [
      riddle,
      solutionCriteria,
      keeper,
      coinHolder,
      prizePool,
      round,
      stakeAmount,
      maxAttempts,
      contractBalance,
    ] = await Promise.all([
      this.read("get_riddle"),
      this.read("get_solution_criteria"),
      this.read("get_keeper"),
      this.read("get_coin_holder"),
      this.read("get_prize_pool"),
      this.read("get_round"),
      this.read("get_stake_amount"),
      this.read("get_max_attempts"),
      this.read("get_contract_balance"),
    ]);
    return {
      riddle: toStringValue(riddle),
      solutionCriteria: toStringValue(solutionCriteria),
      keeper: toStringValue(keeper),
      coinHolder: toStringValue(coinHolder),
      prizePool: toBigInt(prizePool),
      round: toBigInt(round),
      stakeAmount: toBigInt(stakeAmount),
      maxAttempts: toBigInt(maxAttempts),
      contractBalance: toBigInt(contractBalance),
    };
  }

  async getPlayerState(address: string): Promise<PlayerState> {
    const [attempts, wins, points, winnings, claimed] = await Promise.all([
      this.read("get_attempts", [address]),
      this.read("get_wins", [address]),
      this.read("get_points", [address]),
      this.read("get_winnings", [address]),
      this.read("get_claimed", [address]),
    ]);
    return {
      attempts: toBigInt(attempts),
      wins: toBigInt(wins),
      points: toBigInt(points),
      winnings: toBigInt(winnings),
      claimed: toBigInt(claimed),
    };
  }

  /** Full points leaderboard, sorted by points desc, with wins per player. */
  async getLeaderboard(): Promise<LeaderboardEntry[]> {
    const pointsMap = await this.read("get_leaderboard");
    const entries = mapEntries(pointsMap).map(([address, points]) => ({
      address: String(address),
      points: toBigInt(points),
    }));
    if (entries.length === 0) return [];
    const wins = await Promise.all(
      entries.map((e) => this.read("get_wins", [e.address])),
    );
    return entries
      .map((e, i) => ({ ...e, wins: toBigInt(wins[i]) }))
      .sort((a, b) => (a.points > b.points ? -1 : a.points < b.points ? 1 : 0));
  }

  /** Submit an answer with a GEN stake (payable). */
  async attempt(answer: string, stakeWei: bigint): Promise<TxResult> {
    if (answer.trim() === "") throw new Error("Answer must not be empty");
    return this.write("attempt", [answer], stakeWei);
  }

  /** Claim unclaimed winnings as a real GEN transfer. */
  async claimWinnings(): Promise<TxResult> {
    return this.write("claim_winnings", [], 0n);
  }

  /** Keeper only: set the next riddle (only when no riddle is active). */
  async setRiddle(riddle: string, criteria: string): Promise<TxResult> {
    if (riddle.trim() === "" || criteria.trim() === "") {
      throw new Error("Riddle and solution criteria must not be empty");
    }
    return this.write("set_riddle", [riddle, criteria], 0n);
  }
}
