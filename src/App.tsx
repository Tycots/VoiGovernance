import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  HashRouter,
  Link,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { useWallet, type Wallet } from "@txnlab/use-wallet-react";
import {
  APP_ADDRESS,
  APP_ID,
  MAX_SLOTS,
  MAX_WHITELIST,
  VOTE_TYPES,
  WALLETCONNECT_PROJECT_ID,
} from "./config";
import { useGovernance } from "./hooks/useGovernance";
import {
  castVote,
  evaluateExpiration,
  explorerTxUrl,
  hasVoted,
  initializeProposal,
  resolveProposal,
  terminateProposal,
  truncateAddress,
  updateWhitelist,
} from "./lib/contract";
import { getProposalDetail, saveProposalDetail } from "./lib/proposalDetails";

function WalletOption({
  wallet,
  onConnected,
}: {
  wallet: Wallet;
  onConnected: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      await wallet.connect();
      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="wallet-option">
      <button
        className="button button-primary button-full"
        disabled={busy}
        onClick={() => void connect()}
      >
        {busy ? "Connecting..." : wallet.metadata.name}
      </button>
      {error && <small className="error-text">{error}</small>}
    </div>
  );
}

function WalletButton() {
  const { activeWallet, activeAddress, wallets, isReady } = useWallet();
  const [open, setOpen] = useState(false);
  if (!isReady)
    return (
      <button className="button button-quiet" disabled>
        Loading wallet...
      </button>
    );
  if (activeWallet && activeAddress)
    return (
      <div className="connected">
        <span className="wallet-dot" />{" "}
        <code>{truncateAddress(activeAddress)}</code>
        <button
          className="button button-quiet button-small"
          onClick={() => void activeWallet.disconnect()}
        >
          Disconnect
        </button>
      </div>
    );
  return (
    <div className="wallet-picker">
      <button
        className="button button-primary"
        onClick={() => setOpen((value) => !value)}
      >
        Connect wallet
      </button>
      {open && (
        <div className="wallet-menu">
          {wallets.map((wallet) => (
            <WalletOption
              key={wallet.walletKey}
              wallet={wallet}
              onConnected={() => setOpen(false)}
            />
          ))}
          {!WALLETCONNECT_PROJECT_ID && (
            <small className="muted">
              Add a WalletConnect project ID to enable mobile wallets.
            </small>
          )}
        </div>
      )}
    </div>
  );
}

function Layout() {
  const location = useLocation();
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">V</span>
          <span>
            <strong>Voi Council</strong>
            <small>Governance terminal</small>
          </span>
        </Link>
        <WalletButton />
      </header>
      <nav className="nav">
        <NavLink
          to="/"
          end
          className={location.pathname === "/" ? "active" : ""}
        >
          Overview
        </NavLink>
        <NavLink
          to="/vote"
          className={location.pathname === "/vote" ? "active" : ""}
        >
          Cast vote
        </NavLink>
        <NavLink
          to="/admin"
          className={location.pathname === "/admin" ? "active" : ""}
        >
          Admin
        </NavLink>
      </nav>
      <section className="network-strip">
        <span>
          <b>LIVE</b> Voi Mainnet
        </span>
        <span>
          APP <strong>{APP_ID}</strong>
        </span>
        <a
          href={`https://explorer.voi.network/explorer/application/${APP_ID}/transactions`}
          target="_blank"
          rel="noreferrer"
        >
          Explorer <span aria-hidden="true">↗</span>
        </a>
      </section>
      <main>
        <Outlet />
      </main>
      <footer>
        <span>Voi Council Voting</span>
        <a
          href={`https://explorer.voi.network/explorer/application/${APP_ID}/transactions`}
          target="_blank"
          rel="noreferrer"
        >
          {APP_ADDRESS.slice(0, 8)}...{APP_ADDRESS.slice(-6)}
        </a>
      </footer>
    </div>
  );
}

function Notice({
  message,
}: {
  message: { type: "ok" | "err"; text: string } | null;
}) {
  if (!message) return null;
  const tx =
    message.type === "ok" ? message.text.match(/Tx: (\S+)/)?.[1] : undefined;
  return (
    <div
      className={`notice ${message.type === "ok" ? "notice-ok" : "notice-error"}`}
    >
      {message.text}
      {tx && (
        <a href={explorerTxUrl(tx)} target="_blank" rel="noreferrer">
          View transaction ↗
        </a>
      )}
    </div>
  );
}

function TransactionConfirmModal({
  action,
  address,
  onCancel,
  onConfirm,
}: {
  action: { label: string; proposalId: number };
  address: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onCancel();
      }}
    >
      <section
        className="transaction-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-title"
      >
        <span className="kicker">WALLET SIGNATURE</span>
        <h2 id="transaction-title">Check your wallet</h2>
        <p>
          Your wallet will open next so you can review and sign this
          transaction.
        </p>
        <div className="transaction-summary">
          <span>Action</span>
          <strong>{action.label}</strong>
          <span>Proposal</span>
          <strong>#{action.proposalId}</strong>
          <span>Signing wallet</span>
          <code>{truncateAddress(address)}</code>
        </div>
        <div className="modal-actions">
          <button
            className="button button-quiet"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="button button-primary"
            type="button"
            onClick={onConfirm}
          >
            Continue to wallet
          </button>
        </div>
      </section>
    </div>
  );
}

function ProposalCard({
  proposal,
  voterIndex,
  whitelistSize,
  onVote,
  onExpire,
  busy,
}: {
  proposal: any;
  voterIndex: number;
  whitelistSize: number;
  onVote: (slot: number, type: number) => void;
  onExpire: (slot: number) => void;
  busy: number | null;
}) {
  const expired = Math.floor(Date.now() / 1000) > proposal.expiration;
  const voted = voterIndex >= 0 && hasVoted(proposal, voterIndex);
  const total = proposal.yea + proposal.nay + proposal.abstain;
  const detail = getProposalDetail(proposal.proposalId);
  return (
    <article className="proposal-card">
      <div className="proposal-top">
        <span className="eyebrow">
          SLOT {String(proposal.slot).padStart(2, "0")}
        </span>
        <span className={expired ? "status status-closed" : "status"}>
          {expired ? "Closed" : "Open"}
        </span>
      </div>
      <h3>
        Proposal <em>#{proposal.proposalId}</em>
      </h3>
      {detail && <p className="proposal-detail">{detail}</p>}
      <div className="tally">
        <div>
          <strong className="yea">{proposal.yea}</strong>
          <small>Yea</small>
        </div>
        <div>
          <strong className="nay">{proposal.nay}</strong>
          <small>Nay</small>
        </div>
        <div>
          <strong>{proposal.abstain}</strong>
          <small>Abstain</small>
        </div>
      </div>
      <div className="progress">
        <span
          style={{
            width: whitelistSize
              ? `${Math.min(100, (total / whitelistSize) * 100)}%`
              : "0%",
          }}
        />
      </div>
      <p className="muted">
        {total} of {whitelistSize} votes cast ·{" "}
        {new Date(proposal.expiration * 1000).toLocaleString()}
      </p>
      {expired ? (
        <button
          className="button button-quiet button-full"
          disabled={busy !== null}
          onClick={() => onExpire(proposal.slot)}
        >
          {busy === proposal.slot
            ? "Finalizing..."
            : "Finalize expired proposal"}
        </button>
      ) : voted ? (
        <div className="voted">Your vote is recorded</div>
      ) : (
        <div className="vote-buttons">
          <button
            className="button button-yea"
            disabled={busy !== null || voterIndex < 0}
            onClick={() => onVote(proposal.slot, VOTE_TYPES.YEA)}
          >
            Yea
          </button>
          <button
            className="button button-nay"
            disabled={busy !== null || voterIndex < 0}
            onClick={() => onVote(proposal.slot, VOTE_TYPES.NAY)}
          >
            Nay
          </button>
          <button
            className="button button-quiet"
            disabled={busy !== null || voterIndex < 0}
            onClick={() => onVote(proposal.slot, VOTE_TYPES.ABSTAIN)}
          >
            Abstain
          </button>
        </div>
      )}
    </article>
  );
}

function Overview() {
  const { globalState, proposals, loading, error } = useGovernance();
  const active = proposals.filter((proposal) => proposal.active);
  return (
    <div className="page">
      <section className="hero">
        <div>
          <span className="kicker">ON-CHAIN GOVERNANCE / VOI</span>
          <h1>Decisions, recorded.</h1>
          <p>
            A focused voting room for the Voi Council. Every vote is signed by a
            whitelisted wallet and settled on-chain.
          </p>
        </div>
        <div className="hero-stamp">
          <span>ACTIVE PROPOSALS</span>
          <strong>{active.length.toString().padStart(2, "0")}</strong>
        </div>
      </section>
      {loading && <div className="notice">Reading contract state...</div>}
      {error && <div className="notice notice-error">{error}</div>}
      {globalState && (
        <div className="metrics">
          <div>
            <span>Admin</span>
            <strong>
              {globalState.admin
                ? truncateAddress(globalState.admin)
                : "Unknown"}
            </strong>
          </div>
          <div>
            <span>Voters</span>
            <strong>
              {globalState.whitelist.length} <small>/ {MAX_WHITELIST}</small>
            </strong>
          </div>
          <div>
            <span>Proposal slots</span>
            <strong>{globalState.maxSlots}</strong>
          </div>
        </div>
      )}
      <section className="section-heading">
        <div>
          <span className="kicker">CURRENT AGENDA</span>
          <h2>Open proposals</h2>
        </div>
        <Link className="text-link" to="/vote">
          Go to voting room ↗
        </Link>
      </section>
      {active.length ? (
        <div className="proposal-grid">
          {active.map((proposal) => (
            <ProposalCard
              key={proposal.slot}
              proposal={proposal}
              voterIndex={-1}
              whitelistSize={globalState?.whitelist.length ?? 0}
              onVote={() => undefined}
              onExpire={() => undefined}
              busy={null}
            />
          ))}
        </div>
      ) : (
        <div className="empty">
          <strong>No active proposals</strong>
          <span>The council has no open decisions right now.</span>
        </div>
      )}
    </div>
  );
}

function VotePage() {
  const { activeAddress, transactionSigner } = useWallet();
  const { globalState, proposals, loading, error, refresh } = useGovernance();
  const [busy, setBusy] = useState<number | null>(null);
  const [message, setMessage] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    slot: number;
    proposalId: number;
    label: string;
    run: () => Promise<string>;
    success: string;
  } | null>(null);
  const isAdmin = Boolean(
    activeAddress && globalState?.admin === activeAddress,
  );
  const adminActionableProposals = proposals.filter(
    (proposal) => proposal.exists && proposal.proposalId > 0,
  );
  const voterIndex = useMemo(
    () =>
      activeAddress && globalState
        ? globalState.whitelist.findIndex(
            (address) => address === activeAddress,
          )
        : -1,
    [activeAddress, globalState],
  );
  const act = async (
    slot: number,
    action: () => Promise<string>,
    success: string,
  ) => {
    setBusy(slot);
    setMessage(null);
    try {
      const tx = await action();
      setMessage({ type: "ok", text: `${success} Tx: ${tx}` });
      await refresh();
    } catch (err) {
      setMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Transaction failed",
      });
    } finally {
      setBusy(null);
    }
  };
  const active = proposals.filter((proposal) => proposal.active);
  const resolve = async (proposalSlot: number, resolution: number) => {
    if (!activeAddress) return;
    setBusy(proposalSlot);
    setMessage(null);
    try {
      const tx = await resolveProposal(
        proposalSlot,
        resolution,
        activeAddress,
        transactionSigner,
      );
      setMessage({
        type: "ok",
        text: `Proposal ${resolution === 1 ? "approved" : "rejected"}. Tx: ${tx}`,
      });
      await refresh();
    } catch (err) {
      setMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Resolution failed",
      });
    } finally {
      setBusy(null);
    }
  };
  const requestVote = (slot: number, type: number) => {
    const proposal = proposals.find((item) => item.slot === slot);
    if (!activeAddress || !proposal) return;
    const label =
      type === VOTE_TYPES.YEA
        ? "Vote Yea"
        : type === VOTE_TYPES.NAY
          ? "Vote Nay"
          : "Vote Abstain";
    setPendingAction({
      slot,
      proposalId: proposal.proposalId,
      label,
      run: () => castVote(slot, type, activeAddress, transactionSigner),
      success: "Vote submitted.",
    });
  };
  const requestExpiration = (slot: number) => {
    const proposal = proposals.find((item) => item.slot === slot);
    if (!activeAddress || !proposal) return;
    setPendingAction({
      slot,
      proposalId: proposal.proposalId,
      label: "Finalize expired proposal",
      run: () => evaluateExpiration(slot, activeAddress, transactionSigner),
      success: "Proposal finalized.",
    });
  };
  const confirmTransaction = async () => {
    if (!pendingAction) return;
    const action = pendingAction;
    setPendingAction(null);
    await act(action.slot, action.run, action.success);
  };
  return (
    <div className="page">
      <div className="page-intro">
        <span className="kicker">VOTING ROOM</span>
        <h1>Make your position count.</h1>
        <p>
          One signed vote per active proposal. The full tally remains visible to
          everyone.
        </p>
      </div>
      {!activeAddress && (
        <div className="notice notice-warn">
          Connect a whitelisted wallet to cast a vote.
        </div>
      )}
      {activeAddress && globalState && voterIndex < 0 && (
        <div className="notice notice-warn">
          {truncateAddress(activeAddress)} is not on the current whitelist.
        </div>
      )}
      {activeAddress && voterIndex >= 0 && (
        <div className="notice notice-ok">
          Whitelisted voter · position {voterIndex + 1}
        </div>
      )}
      <Notice message={message} />
      {loading && <div className="notice">Loading proposals...</div>}
      {error && <div className="notice notice-error">{error}</div>}
      {active.length ? (
        <div className="proposal-grid">
          {active.map((proposal) => (
            <ProposalCard
              key={proposal.slot}
              proposal={proposal}
              voterIndex={voterIndex}
              whitelistSize={globalState?.whitelist.length ?? 0}
              busy={busy}
              onVote={requestVote}
              onExpire={requestExpiration}
            />
          ))}
        </div>
      ) : (
        <div className="empty">
          <strong>Nothing to vote on</strong>
          <span>
            Open proposals will appear here as soon as the admin initializes
            one.
          </span>
        </div>
      )}
      {isAdmin && adminActionableProposals.length > 0 && (
        <section className="panel active-admin">
          <div className="panel-title">
            <span className="step">03</span>
            <div>
              <h2>Resolve proposals</h2>
              <p>
                Admin action is available while the proposal is active or after
                the vote window closes.
              </p>
            </div>
          </div>
          {adminActionableProposals.map((proposal) => (
            <div className="admin-row" key={proposal.slot}>
              <span>
                Slot {proposal.slot} · Proposal #{proposal.proposalId} · {proposal.active ? "Active" : "Closed"} · Y {proposal.yea} / N {proposal.nay} / A {proposal.abstain}
              </span>
              <div className="vote-buttons">
                <button
                  className="button button-yea button-small"
                  disabled={Boolean(busy) || !isAdmin}
                  onClick={() => void resolve(proposal.slot, 1)}
                >
                  {busy === proposal.slot ? "Saving..." : "Approve"}
                </button>
                <button
                  className="button button-nay button-small"
                  disabled={Boolean(busy) || !isAdmin}
                  onClick={() => void resolve(proposal.slot, 2)}
                >
                  {busy === proposal.slot ? "Saving..." : "Reject"}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
      {pendingAction && activeAddress && (
        <TransactionConfirmModal
          action={pendingAction}
          address={activeAddress}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void confirmTransaction()}
        />
      )}
    </div>
  );
}

function AdminPage() {
  const { activeAddress, transactionSigner } = useWallet();
  const { globalState, proposals, loading, refresh } = useGovernance();
  const [whitelist, setWhitelist] = useState("");
  const [proposalId, setProposalId] = useState("");
  const [proposalDetail, setProposalDetail] = useState("");
  const [duration, setDuration] = useState("24");
  const [slot, setSlot] = useState(0);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);
  const isAdmin = Boolean(
    activeAddress && globalState?.admin === activeAddress,
  );
  useEffect(() => {
    if (globalState) setWhitelist(globalState.whitelist.join("\n"));
  }, [globalState]);

  const saveWhitelist = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeAddress) return;
    const addresses = whitelist
      .split(/[\n,]+/)
      .map((address) => address.trim())
      .filter(Boolean);
    if (
      addresses.length > MAX_WHITELIST ||
      addresses.some((address) => !/^[A-Z2-7]{58}$/.test(address))
    ) {
      setMessage({ type: "err", text: "Use up to 10 valid Voi addresses." });
      return;
    }
    setBusy("whitelist");
    try {
      const tx = await updateWhitelist(
        addresses,
        activeAddress,
        transactionSigner,
      );
      setMessage({ type: "ok", text: `Whitelist updated. Tx: ${tx}` });
      await refresh();
    } catch (err) {
      setMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Update failed",
      });
    } finally {
      setBusy("");
    }
  };

  const initialize = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeAddress) return;
    const id = Number(proposalId);
    const hours = Number(duration);
    if (
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      !proposalDetail.trim() ||
      !Number.isFinite(hours) ||
      hours <= 0
    ) {
      setMessage({
        type: "err",
        text: "Enter a proposal ID, description, and positive duration.",
      });
      return;
    }
    setBusy("proposal");
    try {
      const tx = await initializeProposal(
        slot,
        id,
        Math.round(hours * 3600),
        activeAddress,
        transactionSigner,
      );
      saveProposalDetail(id, proposalDetail);
      setMessage({ type: "ok", text: `Proposal initialized. Tx: ${tx}` });
      setProposalId("");
      setProposalDetail("");
      await refresh();
    } catch (err) {
      setMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Initialization failed",
      });
    } finally {
      setBusy("");
    }
  };

  const terminate = async (proposalSlot: number) => {
    if (!activeAddress) return;
    setBusy(`terminate-${proposalSlot}`);
    try {
      const tx = await terminateProposal(
        proposalSlot,
        new TextEncoder().encode("Terminated by admin"),
        activeAddress,
        transactionSigner,
      );
      setMessage({ type: "ok", text: `Proposal terminated. Tx: ${tx}` });
      await refresh();
    } catch (err) {
      setMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Termination failed",
      });
    } finally {
      setBusy("");
    }
  };

  const resolve = async (proposalSlot: number, resolution: number) => {
    if (!activeAddress) return;
    setBusy(`resolve-${proposalSlot}-${resolution}`);
    try {
      const tx = await resolveProposal(
        proposalSlot,
        resolution,
        activeAddress,
        transactionSigner,
      );
      setMessage({
        type: "ok",
        text: `Proposal ${resolution === 1 ? "approved" : "rejected"}. Tx: ${tx}`,
      });
      await refresh();
    } catch (err) {
      setMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Resolution failed",
      });
    } finally {
      setBusy("");
    }
  };

  const activeProposals = proposals.filter((proposal) => proposal.active);
  const resolvableProposals = proposals.filter(
    (proposal) => proposal.exists && !proposal.active && proposal.proposalId > 0,
  );
  return (
    <div className="page">
      <div className="page-intro">
        <span className="kicker">ADMIN CONSOLE</span>
        <h1>Shape the agenda.</h1>
        <p>
          Manage voters, publish proposal details, and close active decisions.
        </p>
      </div>
      {!activeAddress && (
        <div className="notice notice-warn">
          Connect the admin wallet to continue.
        </div>
      )}
      {activeAddress && !loading && !isAdmin && (
        <div className="notice notice-warn">
          This wallet is not the contract admin.
        </div>
      )}
      <Notice message={message} />
      <div className="admin-grid">
        <section className="panel">
          <div className="panel-title">
            <span className="step">01</span>
            <div>
              <h2>Voter whitelist</h2>
              <p>Replace the complete list, one address per line.</p>
            </div>
          </div>
          <form onSubmit={(event) => void saveWhitelist(event)}>
            <textarea
              rows={8}
              value={whitelist}
              onChange={(event) => setWhitelist(event.target.value)}
              disabled={!isAdmin || Boolean(busy)}
              placeholder="VOI wallet address..."
            />
            <button
              className="button button-primary button-full"
              disabled={!isAdmin || Boolean(busy)}
            >
              {busy === "whitelist" ? "Saving..." : "Save whitelist"}
            </button>
          </form>
        </section>
        <section className="panel">
          <div className="panel-title">
            <span className="step">02</span>
            <div>
              <h2>Open a proposal</h2>
              <p>The description is shown to voters next to the tally.</p>
            </div>
          </div>
          <form onSubmit={(event) => void initialize(event)}>
            <label>
              Slot
              <select
                value={slot}
                onChange={(event) => setSlot(Number(event.target.value))}
                disabled={!isAdmin || Boolean(busy)}
              >
                {Array.from({ length: MAX_SLOTS }, (_, index) => (
                  <option key={index} value={index}>
                    Slot {index}{" "}
                    {proposals[index]?.active ? "(in use)" : "(open)"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Proposal ID
              <input
                type="number"
                min="1"
                value={proposalId}
                onChange={(event) => setProposalId(event.target.value)}
                placeholder="e.g. 1001"
                disabled={!isAdmin || Boolean(busy)}
              />
            </label>
            <label>
              Proposal details
              <textarea
                rows={5}
                value={proposalDetail}
                onChange={(event) => setProposalDetail(event.target.value)}
                placeholder="What is the council voting on?"
                disabled={!isAdmin || Boolean(busy)}
              />
            </label>
            <p className="form-note">
              Saved in this browser because the deployed contract does not store
              descriptions on-chain.
            </p>
            <label>
              Duration in hours
              <input
                type="number"
                min="0.01"
                step="0.25"
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
                disabled={!isAdmin || Boolean(busy)}
              />
            </label>
            <button
              className="button button-primary button-full"
              disabled={!isAdmin || Boolean(busy)}
            >
              {busy === "proposal" ? "Initializing..." : "Initialize proposal"}
            </button>
          </form>
        </section>
      </div>
      <section className="panel active-admin">
        <div className="panel-title">
          <span className="step">03</span>
          <div>
            <h2>Active slots</h2>
            <p>
              Terminate a proposal when the council needs to close it early.
            </p>
          </div>
        </div>
        {activeProposals.length === 0 ? (
          <p className="muted">No active proposals.</p>
        ) : (
          activeProposals.map((proposal) => (
            <div className="admin-row" key={proposal.slot}>
              <span>
                Slot {proposal.slot} · Proposal #{proposal.proposalId}
              </span>
              <button
                className="button button-quiet button-small"
                disabled={!isAdmin || Boolean(busy)}
                onClick={() => void terminate(proposal.slot)}
              >
                {busy === `terminate-${proposal.slot}`
                  ? "Closing..."
                  : "Terminate"}
              </button>
            </div>
          ))
        )}
      </section>
      <section className="panel active-admin">
        <div className="panel-title">
          <span className="step">04</span>
          <div>
            <h2>Resolve proposals</h2>
            <p>Record the council outcome after voting is complete.</p>
          </div>
        </div>
        {resolvableProposals.length === 0 ? (
          <p className="muted">No finalized proposals awaiting resolution.</p>
        ) : (
          resolvableProposals.map((proposal) => (
            <div className="admin-row" key={proposal.slot}>
              <span>
                Slot {proposal.slot} · Proposal #{proposal.proposalId} · Y {proposal.yea} / N {proposal.nay} / A {proposal.abstain}
              </span>
              <div className="vote-buttons">
                <button
                  className="button button-yea button-small"
                  disabled={!isAdmin || Boolean(busy)}
                  onClick={() => void resolve(proposal.slot, 1)}
                >
                  {busy === `resolve-${proposal.slot}-1` ? "Saving..." : "Approve"}
                </button>
                <button
                  className="button button-nay button-small"
                  disabled={!isAdmin || Boolean(busy)}
                  onClick={() => void resolve(proposal.slot, 2)}
                >
                  {busy === `resolve-${proposal.slot}-2` ? "Saving..." : "Reject"}
                </button>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function LegacyAdminPage2() {
  const { activeAddress, transactionSigner } = useWallet();
  const { globalState, proposals, loading, refresh } = useGovernance();
  const [whitelist, setWhitelist] = useState("");
  const [proposalId, setProposalId] = useState("");
  const [proposalDetail, setProposalDetail] = useState("");
  const [duration, setDuration] = useState("24");
  const [slot, setSlot] = useState(0);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);
  const isAdmin = Boolean(
    activeAddress && globalState?.admin === activeAddress,
  );
  useEffect(() => {
    if (globalState) setWhitelist(globalState.whitelist.join("\n"));
  }, [globalState]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeAddress) return;
    const id = Number(proposalId);
    const hours = Number(duration);
    if (
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      !proposalDetail.trim() ||
      !Number.isFinite(hours) ||
      hours <= 0
    ) {
      setMessage({
        type: "err",
        text: "Enter a proposal ID, description, and positive duration.",
      });
      return;
    }
    setBusy("proposal");
    try {
      const tx = await initializeProposal(
        slot,
        id,
        Math.round(hours * 3600),
        activeAddress,
        transactionSigner,
      );
      saveProposalDetail(id, proposalDetail);
      setProposalId("");
      setProposalDetail("");
      setMessage({ type: "ok", text: `Proposal initialized. Tx: ${tx}` });
      await refresh();
    } catch (err) {
      setMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Initialization failed",
      });
    } finally {
      setBusy("");
    }
  };

  const saveWhitelist = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeAddress) return;
    const addresses = whitelist
      .split(/[\n,]+/)
      .map((address) => address.trim())
      .filter(Boolean);
    if (
      addresses.length > MAX_WHITELIST ||
      addresses.some((address) => !/^[A-Z2-7]{58}$/.test(address))
    ) {
      setMessage({ type: "err", text: "Use up to 10 valid Voi addresses." });
      return;
    }
    setBusy("whitelist");
    try {
      const tx = await updateWhitelist(
        addresses,
        activeAddress,
        transactionSigner,
      );
      setMessage({ type: "ok", text: `Whitelist updated. Tx: ${tx}` });
      await refresh();
    } catch (err) {
      setMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Update failed",
      });
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="page">
      <div className="page-intro">
        <span className="kicker">ADMIN CONSOLE</span>
        <h1>Shape the agenda.</h1>
        <p>
          Manage voters and publish a readable description alongside each new
          proposal.
        </p>
      </div>
      {!activeAddress && (
        <div className="notice notice-warn">
          Connect the admin wallet to continue.
        </div>
      )}
      {activeAddress && !loading && !isAdmin && (
        <div className="notice notice-warn">
          This wallet is not the contract admin.
        </div>
      )}
      <Notice message={message} />
      <div className="admin-grid">
        <section className="panel">
          <div className="panel-title">
            <span className="step">01</span>
            <div>
              <h2>Voter whitelist</h2>
              <p>Replace the complete list, one address per line.</p>
            </div>
          </div>
          <form onSubmit={(event) => void saveWhitelist(event)}>
            <textarea
              rows={8}
              value={whitelist}
              onChange={(event) => setWhitelist(event.target.value)}
              disabled={!isAdmin || Boolean(busy)}
              placeholder="VOI wallet address..."
            />
            <button
              className="button button-primary button-full"
              disabled={!isAdmin || Boolean(busy)}
            >
              {busy === "whitelist" ? "Saving..." : "Save whitelist"}
            </button>
          </form>
        </section>
        <section className="panel">
          <div className="panel-title">
            <span className="step">02</span>
            <div>
              <h2>Open a proposal</h2>
              <p>The description is shown to voters next to the tally.</p>
            </div>
          </div>
          <form onSubmit={(event) => void submit(event)}>
            <label>
              Slot
              <select
                value={slot}
                onChange={(event) => setSlot(Number(event.target.value))}
                disabled={!isAdmin || Boolean(busy)}
              >
                {Array.from({ length: MAX_SLOTS }, (_, index) => (
                  <option key={index} value={index}>
                    Slot {index}{" "}
                    {proposals[index]?.active ? "(in use)" : "(open)"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Proposal ID
              <input
                type="number"
                min="1"
                value={proposalId}
                onChange={(event) => setProposalId(event.target.value)}
                placeholder="e.g. 1001"
                disabled={!isAdmin || Boolean(busy)}
              />
            </label>
            <label>
              Proposal details
              <textarea
                rows={5}
                value={proposalDetail}
                onChange={(event) => setProposalDetail(event.target.value)}
                placeholder="What is the council voting on?"
                disabled={!isAdmin || Boolean(busy)}
              />
            </label>
            <p className="form-note">
              Saved in this browser because the deployed contract does not store
              descriptions on-chain.
            </p>
            <label>
              Duration in hours
              <input
                type="number"
                min="0.01"
                step="0.25"
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
                disabled={!isAdmin || Boolean(busy)}
              />
            </label>
            <button
              className="button button-primary button-full"
              disabled={!isAdmin || Boolean(busy)}
            >
              {busy === "proposal" ? "Initializing..." : "Initialize proposal"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

function LegacyAdminPage() {
  const { activeAddress, transactionSigner } = useWallet();
  const { globalState, proposals, loading, refresh } = useGovernance();
  const [whitelist, setWhitelist] = useState("");
  const [proposalId, setProposalId] = useState("");
  const [proposalDetail, setProposalDetail] = useState("");
  const [duration, setDuration] = useState("24");
  const [slot, setSlot] = useState(0);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);
  const isAdmin = Boolean(
    activeAddress && globalState?.admin === activeAddress,
  );
  useEffect(() => {
    if (globalState) setWhitelist(globalState.whitelist.join("\n"));
  }, [globalState]);
  const submitWhitelist = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeAddress) return;
    const addresses = whitelist
      .split(/[\n,]+/)
      .map((address) => address.trim())
      .filter(Boolean);
    if (
      addresses.length > MAX_WHITELIST ||
      addresses.some((address) => !/^[A-Z2-7]{58}$/.test(address))
    ) {
      setMessage({ type: "err", text: "Use up to 10 valid Voi addresses." });
      return;
    }
    setBusy("whitelist");
    setMessage(null);
    try {
      const tx = await updateWhitelist(
        addresses,
        activeAddress,
        transactionSigner,
      );
      setMessage({ type: "ok", text: `Whitelist updated. Tx: ${tx}` });
      await refresh();
    } catch (err) {
      setMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Update failed",
      });
    } finally {
      setBusy("");
    }
  };
  const submitProposal = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeAddress) return;
    const id = Number(proposalId);
    const hours = Number(duration);
    if (
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      !Number.isFinite(hours) ||
      hours <= 0 ||
      !proposalDetail.trim()
    ) {
      setMessage({
        type: "err",
        text: "Enter a positive proposal ID, duration, and description.",
      });
      return;
    }
    setBusy("proposal");
    setMessage(null);
    try {
      const tx = await initializeProposal(
        slot,
        id,
        Math.round(hours * 3600),
        activeAddress,
        transactionSigner,
      );
      saveProposalDetail(id, proposalDetail);
      setMessage({
        type: "ok",
        text: `Proposal initialized in slot ${slot}. Tx: ${tx}`,
      });
      setProposalId("");
      setProposalDetail("");
      await refresh();
    } catch (err) {
      setMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Initialization failed",
      });
    } finally {
      setBusy("");
    }
  };
  const terminate = async (proposalSlot: number) => {
    if (!activeAddress) return;
    setBusy(`terminate-${proposalSlot}`);
    try {
      const tx = await terminateProposal(
        proposalSlot,
        new TextEncoder().encode("Terminated by admin"),
        activeAddress,
        transactionSigner,
      );
      setMessage({ type: "ok", text: `Proposal terminated. Tx: ${tx}` });
      await refresh();
    } catch (err) {
      setMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Termination failed",
      });
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="page">
      <div className="page-intro">
        <span className="kicker">ADMIN CONSOLE</span>
        <h1>Shape the agenda.</h1>
        <p>
          Manage the council whitelist and open the next decision. Admin actions
          require the contract admin wallet.
        </p>
      </div>
      {!activeAddress && (
        <div className="notice notice-warn">
          Connect the admin wallet to continue.
        </div>
      )}
      {activeAddress && !loading && !isAdmin && (
        <div className="notice notice-warn">
          This wallet is not the contract admin.
        </div>
      )}
      <Notice message={message} />
      <div className="admin-grid">
        <section className="panel">
          <div className="panel-title">
            <span className="step">01</span>
            <div>
              <h2>Voter whitelist</h2>
              <p>Replace the complete list, one address per line.</p>
            </div>
          </div>
          <form onSubmit={(event) => void submitWhitelist(event)}>
            <textarea
              rows={8}
              value={whitelist}
              onChange={(event) => setWhitelist(event.target.value)}
              disabled={!isAdmin || Boolean(busy)}
              placeholder="VOI wallet address..."
            />
            <button
              className="button button-primary button-full"
              disabled={!isAdmin || Boolean(busy)}
            >
              {busy === "whitelist" ? "Saving..." : "Save whitelist"}
            </button>
          </form>
        </section>
        <section className="panel">
          <div className="panel-title">
            <span className="step">02</span>
            <div>
              <h2>Open a proposal</h2>
              <p>Choose an unused slot and voting window.</p>
            </div>
          </div>
          <form onSubmit={(event) => void submitProposal(event)}>
            <label>
              Slot
              <select
                value={slot}
                onChange={(event) => setSlot(Number(event.target.value))}
                disabled={!isAdmin || Boolean(busy)}
              >
                {Array.from({ length: MAX_SLOTS }, (_, index) => (
                  <option key={index} value={index}>
                    Slot {index}{" "}
                    {proposals[index]?.active ? "(in use)" : "(open)"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Proposal ID
              <input
                type="number"
                min="1"
                value={proposalId}
                onChange={(event) => setProposalId(event.target.value)}
                placeholder="e.g. 1001"
                disabled={!isAdmin || Boolean(busy)}
              />
            </label>
            <label>
              Duration in hours
              <input
                type="number"
                min="0.01"
                step="0.25"
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
                disabled={!isAdmin || Boolean(busy)}
              />
            </label>
            <button
              className="button button-primary button-full"
              disabled={!isAdmin || Boolean(busy)}
            >
              {busy === "proposal" ? "Initializing..." : "Initialize proposal"}
            </button>
          </form>
        </section>
      </div>
      <section className="panel active-admin">
        <div className="panel-title">
          <span className="step">03</span>
          <div>
            <h2>Active slots</h2>
            <p>
              Terminate a proposal when the council needs to close it early.
            </p>
          </div>
        </div>
        {proposals
          .filter((proposal) => proposal.active)
          .map((proposal) => (
            <div className="admin-row" key={proposal.slot}>
              <span>
                Slot {proposal.slot} · Proposal #{proposal.proposalId}
              </span>
              <button
                className="button button-quiet button-small"
                disabled={!isAdmin || Boolean(busy)}
                onClick={() => void terminate(proposal.slot)}
              >
                {busy === `terminate-${proposal.slot}`
                  ? "Closing..."
                  : "Terminate"}
              </button>
            </div>
          ))}
      </section>
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="vote" element={<VotePage />} />
          <Route path="admin" element={<AdminPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
