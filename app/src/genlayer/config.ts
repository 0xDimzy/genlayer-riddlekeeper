// RiddleKeeper deployment facts — verified live on Studionet 2026-11-26.
// Contract source: ../contracts/riddle_keeper.py
// Deploy tx: 0x8a547fd5a234ccbaecd940432a45d0737ab2659adc670c19b27ee093063ecb04

export const CONTRACT_ADDRESS = (import.meta.env
  .VITE_CONTRACT_ADDRESS as string | undefined) ||
  "0x16A84c3e070b89405ffE2bfAE9c4C8Fe8b88ac7a";

export const GENLAYER_RPC_URL = (import.meta.env.VITE_GENLAYER_RPC_URL as
  | string
  | undefined) || "https://studio.genlayer.com/api";

export const GENLAYER_CHAIN_ID = Number(
  (import.meta.env.VITE_GENLAYER_CHAIN_ID as string | undefined) || "61999",
);

export const GENLAYER_CHAIN_ID_HEX = `0x${GENLAYER_CHAIN_ID.toString(16).toUpperCase()}`;

export const GENLAYER_CHAIN_NAME = (import.meta.env
  .VITE_GENLAYER_CHAIN_NAME as string | undefined) || "GenLayer Studio";

export const GENLAYER_SYMBOL = (import.meta.env.VITE_GENLAYER_SYMBOL as
  | string
  | undefined) || "GEN";

// Keeper (deployer) of the live deployment, from get_keeper().
// NOTE: this is a Studio-managed local account (0xD7Cc…b48a). It cannot
// sign from MetaMask, so the keeper panel in this app is functional code
// (it calls set_riddle when the connected wallet IS the keeper) but for
// this deployment the keeper sets riddles from Studio Run & Debug.
// The game itself (play / claim / leaderboard) works from any wallet.
export const DEPLOYED_KEEPER =
  "0xD7Cc6ed137a5f05bf6A6B6591Ea7b99237abb48a";

export const STUDIO_IMPORT_URL = `https://studio.genlayer.com/?import-contract=${CONTRACT_ADDRESS}`;
export const EXPLORER_URL = `https://explorer-studio.genlayer.com/address/${CONTRACT_ADDRESS.toLowerCase()}`;
export const GITHUB_REPO_URL = "https://github.com/0xDimzy/genlayer-riddlekeeper";

export const GENLAYER_NETWORK_PARAMS = {
  chainId: GENLAYER_CHAIN_ID_HEX,
  chainName: GENLAYER_CHAIN_NAME,
  nativeCurrency: {
    name: GENLAYER_SYMBOL,
    symbol: GENLAYER_SYMBOL,
    decimals: 18,
  },
  rpcUrls: [GENLAYER_RPC_URL],
  blockExplorerUrls: ["https://explorer-studio.genlayer.com/"],
};

/** Format a wei bigint as a GEN amount with up to 6 decimals. */
export function formatGen(wei: bigint): string {
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;
  const whole = abs / 10n ** 18n;
  const frac = abs % 10n ** 18n;
  const fracStr = frac.toString().padStart(18, "0").slice(0, 6).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${fracStr ? `.${fracStr}` : ""}`;
}

/** Parse a decimal GEN string into wei. Throws on invalid input. */
export function parseGen(input: string): bigint {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`"${input}" is not a valid GEN amount`);
  }
  const [whole, frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "0".repeat(18)).slice(0, 18);
  return BigInt(whole) * 10n ** 18n + BigInt(fracPadded);
}

export function shortAddress(address: string): string {
  if (!address) return "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
