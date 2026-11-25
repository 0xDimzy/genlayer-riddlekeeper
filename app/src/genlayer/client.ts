// Wallet + GenLayer client wiring.
// Pattern follows the official boilerplate
// (github.com/genlayerlabs/genlayer-project-boilerplate, frontend/lib/genlayer/client.ts):
//   - MetaMask via window.ethereum (EIP-1193)
//   - wallet_switchEthereumChain / wallet_addEthereumChain for Studionet
//   - genlayer-js createClient({ chain: studionet, account? })
// The SDK uses window.ethereum for signing when an account is set; there
// is no custom-transport support in genlayer-js.

import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import {
  GENLAYER_CHAIN_ID,
  GENLAYER_CHAIN_ID_HEX,
  GENLAYER_NETWORK_PARAMS,
  GENLAYER_RPC_URL,
} from "./config";

export interface EthereumProvider {
  isMetaMask?: boolean;
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export function getEthereumProvider(): EthereumProvider | null {
  if (typeof window === "undefined") return null;
  return window.ethereum ?? null;
}

export function isMetaMaskInstalled(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.ethereum?.isMetaMask);
}

export async function requestAccounts(): Promise<string[]> {
  const provider = getEthereumProvider();
  if (!provider) throw new Error("MetaMask is not installed");
  try {
    const accounts = (await provider.request({
      method: "eth_requestAccounts",
    })) as string[];
    return accounts;
  } catch (error: unknown) {
    const code = (error as { code?: number })?.code;
    if (code === 4001) throw new Error("User rejected the connection request");
    throw new Error(
      `Failed to connect to MetaMask: ${(error as Error).message ?? error}`,
    );
  }
}

export async function getAccounts(): Promise<string[]> {
  const provider = getEthereumProvider();
  if (!provider) return [];
  try {
    return (await provider.request({ method: "eth_accounts" })) as string[];
  } catch {
    return [];
  }
}

export async function getCurrentChainId(): Promise<number | null> {
  const provider = getEthereumProvider();
  if (!provider) return null;
  try {
    const chainId = (await provider.request({
      method: "eth_chainId",
    })) as string;
    return parseInt(chainId, 16);
  } catch {
    return null;
  }
}

export async function addGenLayerNetwork(): Promise<void> {
  const provider = getEthereumProvider();
  if (!provider) throw new Error("MetaMask is not installed");
  try {
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [GENLAYER_NETWORK_PARAMS],
    });
  } catch (error: unknown) {
    const code = (error as { code?: number })?.code;
    if (code === 4001) throw new Error("User rejected adding the network");
    throw new Error(
      `Failed to add GenLayer network: ${(error as Error).message ?? error}`,
    );
  }
}

export async function switchToGenLayerNetwork(): Promise<void> {
  const provider = getEthereumProvider();
  if (!provider) throw new Error("MetaMask is not installed");
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: GENLAYER_CHAIN_ID_HEX }],
    });
  } catch (error: unknown) {
    const code = (error as { code?: number })?.code;
    if (code === 4902) {
      await addGenLayerNetwork();
    } else if (code === 4001) {
      throw new Error("User rejected switching the network");
    } else {
      throw new Error(
        `Failed to switch network: ${(error as Error).message ?? error}`,
      );
    }
  }
}

export async function isOnGenLayerNetwork(): Promise<boolean> {
  const chainId = await getCurrentChainId();
  return chainId === GENLAYER_CHAIN_ID;
}

/** Connect MetaMask, switch to Studionet, return the first account. */
export async function connectMetaMask(): Promise<string> {
  if (!isMetaMaskInstalled()) {
    throw new Error(
      "MetaMask is not installed. Install MetaMask, then connect.",
    );
  }
  const accounts = await requestAccounts();
  if (!accounts || accounts.length === 0) {
    throw new Error("No accounts found in MetaMask");
  }
  if (!(await isOnGenLayerNetwork())) {
    await switchToGenLayerNetwork();
  }
  return accounts[0];
}

/** Read the connected wallet's native GEN balance via the wallet RPC. */
export async function getWalletBalance(
  address: string,
): Promise<bigint | null> {
  const provider = getEthereumProvider();
  if (!provider) return null;
  try {
    const hex = (await provider.request({
      method: "eth_getBalance",
      params: [address, "latest"],
    })) as string;
    return BigInt(hex);
  } catch {
    return null;
  }
}

export type GenLayerClient = ReturnType<typeof createClient>;

/** Read-only client (no account): enough for every view method. */
export function createReadClient(): GenLayerClient {
  return createClient({
    chain: studionet,
    endpoint: GENLAYER_RPC_URL,
  } as Parameters<typeof createClient>[0]);
}

/** Client bound to a signing account (MetaMask signs via window.ethereum). */
export function createAccountClient(address: string): GenLayerClient {
  return createClient({
    chain: studionet,
    account: address as `0x${string}`,
    endpoint: GENLAYER_RPC_URL,
  } as Parameters<typeof createClient>[0]);
}
