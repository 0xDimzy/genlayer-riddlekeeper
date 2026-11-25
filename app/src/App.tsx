import { useCallback, useEffect, useRef, useState } from "react";
import {
  connectMetaMask,
  createAccountClient,
  createReadClient,
  getAccounts,
  getCurrentChainId,
  getEthereumProvider,
  getWalletBalance,
  type GenLayerClient,
} from "./genlayer/client";
import {
  CONTRACT_ADDRESS,
  DEPLOYED_KEEPER,
  EXPLORER_URL,
  GENLAYER_CHAIN_ID,
  GENLAYER_SYMBOL,
  GITHUB_REPO_URL,
  STUDIO_IMPORT_URL,
  formatGen,
  parseGen,
  sameAddress,
  shortAddress,
} from "./genlayer/config";
import {
  RiddleKeeper,
  type GameState,
  type LeaderboardEntry,
  type PlayerState,
} from "./genlayer/riddlekeeper";

type TxStatus = {
  kind: "idle" | "pending" | "success" | "error";
  message: string;
  hash?: string;
};

const IDLE_TX: TxStatus = { kind: "idle", message: "" };

export default function App() {
  const [game, setGame] = useState<GameState | null>(null);
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [account, setAccount] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [stake, setStake] = useState("100");
  const [newRiddle, setNewRiddle] = useState("");
  const [newCriteria, setNewCriteria] = useState("");
  const [tx, setTx] = useState<TxStatus>(IDLE_TX);
  const [connecting, setConnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const clientRef = useRef<GenLayerClient | null>(null);

  const getClient = useCallback((): GenLayerClient => {
    if (!clientRef.current) clientRef.current = createReadClient();
    return clientRef.current;
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setLoadError(null);
    try {
      const keeper = new RiddleKeeper(getClient());
      const state = await keeper.getGameState();
      setGame(state);
      const board = await keeper.getLeaderboard();
      setLeaderboard(board);
      if (account) {
        const p = await keeper.getPlayerState(account);
        setPlayer(p);
        const bal = await getWalletBalance(account);
        setBalance(bal);
      }
    } catch (err) {
      setLoadError(
        `Failed to read the contract: ${(err as Error).message ?? err}`,
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [account, getClient]);

  // Initial load + live refresh every 20s.
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(timer);
  }, [refresh]);

  // Reconnect silently if MetaMask is already authorized; track changes.
  useEffect(() => {
    void (async () => {
      const accounts = await getAccounts();
      if (accounts.length > 0) {
        const chainId = await getCurrentChainId();
        if (chainId === GENLAYER_CHAIN_ID) setAccount(accounts[0]);
      }
    })();
    const provider = getEthereumProvider();
    if (!provider) return;
    const onAccounts = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      setAccount(accounts && accounts.length > 0 ? accounts[0] : null);
      setPlayer(null);
      setBalance(null);
    };
    const onChain = () => void refresh();
    provider.on("accountsChanged", onAccounts);
    provider.on("chainChanged", onChain);
    return () => {
      provider.removeListener("accountsChanged", onAccounts);
      provider.removeListener("chainChanged", onChain);
    };
  }, [refresh]);

  const connect = async () => {
    setConnecting(true);
    setTx(IDLE_TX);
    try {
      const address = await connectMetaMask();
      setAccount(address);
      clientRef.current = createAccountClient(address);
      const keeper = new RiddleKeeper(clientRef.current);
      const p = await keeper.getPlayerState(address);
      setPlayer(p);
      setBalance(await getWalletBalance(address));
    } catch (err) {
      setTx({
        kind: "error",
        message: (err as Error).message ?? String(err),
      });
    } finally {
      setConnecting(false);
    }
  };

  const runWrite = async (
    label: string,
    fn: (keeper: RiddleKeeper) => Promise<{ hash: string; status: string }>,
  ) => {
    if (!account) {
      setTx({ kind: "error", message: "Connect your wallet first." });
      return;
    }
    setTx({ kind: "pending", message: `${label} — waiting for signature…` });
    try {
      const keeper = new RiddleKeeper(createAccountClient(account));
      const result = await fn(keeper);
      setTx({
        kind: "success",
        message: `${label} accepted on-chain (receipt status: ${result.status}).`,
        hash: result.hash,
      });
      await refresh();
    } catch (err) {
      setTx({
        kind: "error",
        message: `${label} failed: ${(err as Error).message ?? err}`,
      });
    }
  };

  const submitAnswer = () => {
    let stakeWei: bigint;
    try {
      stakeWei = parseGen(stake);
    } catch (err) {
      setTx({ kind: "error", message: (err as Error).message });
      return;
    }
    if (game && stakeWei < game.stakeAmount) {
      setTx({
        kind: "error",
        message: `Stake too low: the contract requires at least ${formatGen(game.stakeAmount)} GEN.`,
      });
      return;
    }
    void runWrite("Answer submitted", (k) => k.attempt(answer, stakeWei));
  };

  const claim = () => {
    void runWrite("Winnings claimed", (k) => k.claimWinnings());
  };

  const setRiddle = () => {
    void runWrite("Riddle set", (k) => k.setRiddle(newRiddle, newCriteria));
  };

  const hasRiddle = Boolean(game && game.riddle !== "");
  const isKeeper = Boolean(account && game && sameAddress(account, game.keeper));
  const attemptsLeft =
    player && game ? game.maxAttempts - player.attempts : null;
  const canPlay =
    hasRiddle && account && !isKeeper && (attemptsLeft === null || attemptsLeft > 0n);

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1>🪙 RiddleKeeper</h1>
          <p className="subtitle">
            A consensus-judged riddle game with GEN staking — an Intelligent
            Contract on GenLayer.
          </p>
        </div>
        <div className="wallet-box">
          {account ? (
            <>
              <div className="account">
                {shortAddress(account)}
                {balance !== null && (
                  <span className="muted">
                    {" "}
                    · {formatGen(balance)} {GENLAYER_SYMBOL}
                  </span>
                )}
              </div>
              <div className="muted small">Studionet · chain {GENLAYER_CHAIN_ID}</div>
            </>
          ) : (
            <button
              className="btn primary"
              onClick={() => void connect()}
              disabled={connecting}
            >
              {connecting ? "Connecting…" : "Connect MetaMask"}
            </button>
          )}
        </div>
      </header>

      <div className="testnet-banner">
        Studionet testnet — GEN has no monetary value. All numbers below are
        read live from the deployed contract; nothing here is mocked.
      </div>

      {loading && <div className="card">Loading game state from Studionet…</div>}

      {loadError && (
        <div className="card error-card">
          <strong>Could not read the contract.</strong>
          <p>{loadError}</p>
          <button className="btn" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      )}

      {game && (
        <>
          <section className="card riddle-card">
            <div className="row-between">
              <h2>
                Round {game.round.toString()}
                {hasRiddle ? "" : " — riddle cleared"}
              </h2>
              <button
                className="btn small"
                onClick={() => void refresh()}
                disabled={refreshing}
              >
                {refreshing ? "Refreshing…" : "Refresh"}
              </button>
            </div>
            {hasRiddle ? (
              <>
                <p className="riddle">“{game.riddle}”</p>
                <p className="criteria">
                  <strong>To win, your answer must satisfy:</strong>{" "}
                  {game.solutionCriteria}
                </p>
              </>
            ) : (
              <p className="riddle muted">
                The last round was won and the riddle is cleared. Waiting for
                the keeper to set the next riddle.
              </p>
            )}
            <div className="stats">
              <div className="stat">
                <span className="stat-label">Prize pool</span>
                <span className="stat-value">
                  {formatGen(game.prizePool)} {GENLAYER_SYMBOL}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">Coin holder</span>
                <span className="stat-value">{shortAddress(game.coinHolder)}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Stake required</span>
                <span className="stat-value">
                  ≥ {formatGen(game.stakeAmount)} {GENLAYER_SYMBOL}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">Attempts / round</span>
                <span className="stat-value">
                  {game.maxAttempts.toString()}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">Contract balance</span>
                <span className="stat-value">
                  {formatGen(game.contractBalance)} {GENLAYER_SYMBOL}
                </span>
              </div>
            </div>
          </section>

          <section className="card">
            <h2>Play</h2>
            {!account && (
              <p className="muted">
                Connect MetaMask (Studionet, chain {GENLAYER_CHAIN_ID}) to
                submit an answer. Your answer is judged by GenLayer
                validators against the public criteria above — the correct
                answer is never stored on-chain.
              </p>
            )}
            {account && isKeeper && (
              <p className="muted">
                You are the keeper — the keeper already knows the riddle and
                cannot play. Use the keeper panel below to set the next
                riddle after a round is won.
              </p>
            )}
            {account && !isKeeper && player && (
              <p>
                Your attempts this round:{" "}
                <strong>
                  {player.attempts.toString()} / {game.maxAttempts.toString()}
                </strong>{" "}
                · Wins: <strong>{player.wins.toString()}</strong> · Points:{" "}
                <strong>{player.points.toString()}</strong>
                <span className="muted small">
                  {" "}
                  (the attempts counter resets on your first attempt of a new
                  round)
                </span>
              </p>
            )}
            <label className="field">
              Your answer
              <input
                type="text"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="e.g. echo"
                disabled={!canPlay || tx.kind === "pending"}
              />
            </label>
            <label className="field">
              Stake ({GENLAYER_SYMBOL})
              <input
                type="text"
                inputMode="decimal"
                value={stake}
                onChange={(e) => setStake(e.target.value)}
                disabled={!canPlay || tx.kind === "pending"}
              />
            </label>
            <button
              className="btn primary"
              onClick={submitAnswer}
              disabled={!canPlay || tx.kind === "pending" || answer.trim() === ""}
            >
              {tx.kind === "pending" ? "Waiting for consensus…" : "Submit answer"}
            </button>
            {!hasRiddle && (
              <p className="muted small">
                No active riddle right now — answers are disabled until the
                keeper sets one.
              </p>
            )}
            {account && !isKeeper && attemptsLeft !== null && attemptsLeft <= 0n && (
              <p className="muted small">
                You have used all {game.maxAttempts.toString()} attempts this
                round. Wait for the next round.
              </p>
            )}
          </section>

          {account && player && player.winnings > 0n && (
            <section className="card claim-card">
              <h2>🎉 You have winnings to claim</h2>
              <p>
                Unclaimed winnings:{" "}
                <strong>
                  {formatGen(player.winnings)} {GENLAYER_SYMBOL}
                </strong>{" "}
                (claimed so far: {formatGen(player.claimed)} {GENLAYER_SYMBOL}
                ). Claiming sends a real GEN transfer from the contract to
                your wallet.
              </p>
              <button
                className="btn primary"
                onClick={claim}
                disabled={tx.kind === "pending"}
              >
                Claim {formatGen(player.winnings)} {GENLAYER_SYMBOL}
              </button>
            </section>
          )}

          {account && isKeeper && (
            <section className="card">
              <h2>Keeper panel</h2>
              <p className="muted">
                You are the keeper ({shortAddress(game.keeper)}). A new riddle
                can only be set while no riddle is active.
              </p>
              <label className="field">
                New riddle
                <input
                  type="text"
                  value={newRiddle}
                  onChange={(e) => setNewRiddle(e.target.value)}
                  placeholder="The more of me you take, the more you leave behind. What am I?"
                  disabled={tx.kind === "pending"}
                />
              </label>
              <label className="field">
                Solution criteria (public — what a correct answer must satisfy)
                <input
                  type="text"
                  value={newCriteria}
                  onChange={(e) => setNewCriteria(e.target.value)}
                  placeholder="The answer must be 'footsteps'…"
                  disabled={tx.kind === "pending"}
                />
              </label>
              <button
                className="btn primary"
                onClick={setRiddle}
                disabled={
                  hasRiddle ||
                  tx.kind === "pending" ||
                  newRiddle.trim() === "" ||
                  newCriteria.trim() === ""
                }
              >
                Set riddle
              </button>
              {hasRiddle && (
                <p className="muted small">
                  A riddle is already active — set the next one after it is
                  won.
                </p>
              )}
            </section>
          )}

          {account && !isKeeper && (
            <p className="muted small">
              Keeper: {shortAddress(game.keeper)} (deployed keeper is a
              Studio-managed account — it sets riddles from Studio Run &amp;
              Debug; the keeper panel appears only when the keeper wallet is
              connected).
            </p>
          )}

          <section className="card">
            <h2>Leaderboard</h2>
            {leaderboard.length === 0 ? (
              <p className="muted">
                No points yet — be the first to solve a riddle.
              </p>
            ) : (
              <table className="board">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Player</th>
                    <th>Points</th>
                    <th>Wins</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((entry, i) => (
                    <tr
                      key={entry.address}
                      className={
                        account && sameAddress(entry.address, account)
                          ? "you"
                          : undefined
                      }
                    >
                      <td>{i + 1}</td>
                      <td>
                        {shortAddress(entry.address)}
                        {account &&
                          sameAddress(entry.address, account) &&
                          " (you)"}
                        {sameAddress(entry.address, game.coinHolder) &&
                          " 👑"}
                      </td>
                      <td>{entry.points.toString()}</td>
                      <td>{entry.wins.toString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="muted small">
              100 points per round won. 👑 marks the current coin holder.
            </p>
          </section>
        </>
      )}

      {tx.kind !== "idle" && (
        <div
          className={`card tx-card ${
            tx.kind === "error"
              ? "error-card"
              : tx.kind === "success"
                ? "success-card"
                : ""
          }`}
        >
          <p>{tx.message}</p>
          {tx.hash && (
            <p>
              Tx:{" "}
              <a
                href={`https://explorer-studio.genlayer.com/transactions/${tx.hash}`}
                target="_blank"
                rel="noreferrer"
              >
                {tx.hash}
              </a>
            </p>
          )}
        </div>
      )}

      <footer className="footer">
        <p>
          Contract{" "}
          <a href={EXPLORER_URL} target="_blank" rel="noreferrer">
            {CONTRACT_ADDRESS}
          </a>{" "}
          on Studionet (chain {GENLAYER_CHAIN_ID}) ·{" "}
          <a href={STUDIO_IMPORT_URL} target="_blank" rel="noreferrer">
            Open in Studio
          </a>{" "}
          ·{" "}
          <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </p>
        <p className="muted small">
          Keeper at deploy: {shortAddress(DEPLOYED_KEEPER)} · RiddleKeeper is
          an original contract — not a fork of the Studio wizard template.
        </p>
      </footer>
    </div>
  );
}
