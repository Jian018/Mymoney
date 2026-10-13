"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mail, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import type { Data, Currency } from "@/lib/finance";
import { cents, money, today } from "@/lib/finance";
import type {
  GmailConnection,
  ReviewCandidate,
  SyncRun,
} from "@/lib/gmail/types";
type Status = {
  configured: boolean;
  connection: GmailConnection | null;
  run: SyncRun | null;
  candidates: ReviewCandidate[];
  pending_count: number;
  saved_count: number;
  active: boolean;
};
async function api(path: string, body?: unknown) {
  const response = await fetch("/api/gmail" + path, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Gmail request failed.");
  return result;
}
export function GmailSync({
  data,
  changed,
}: {
  data: Data;
  changed: () => Promise<void>;
}) {
  const [status, setStatus] = useState<Status | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [open, setOpen] = useState(false),
    [loading, setLoading] = useState(true);
  const gate = useRef(false);
  const refresh = useCallback(async () => {
    try {
      setStatus(await api(""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load Gmail.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const value = new URLSearchParams(location.search).get("gmail");
    if (value) {
      setNotice(
        value === "connected"
          ? "Gmail connected. Press Retrieve Email Data to start a scan."
          : value === "consent_cancelled"
            ? "Google consent was cancelled. No email was scanned."
            : "Gmail authorization could not be completed. Open this app in the same browser used for authorization, then reconnect.",
      );
      const url = new URL(location.href);
      url.searchParams.delete("gmail");
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }, [refresh]);
  // Poll only our scan status, never Gmail. Opening Dashboard never starts a scan.
  useEffect(() => {
    if (!status?.active) return;
    const interval = setInterval(() => void refresh(), 5000);
    return () => clearInterval(interval);
  }, [status?.active, refresh]);
  const connected = status?.connection?.connection_status === "connected",
    active = busy || Boolean(status?.active);
  async function retrieve() {
    if (gate.current || active) return;
    gate.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!connected) {
        const result = await api("/authorize", {});
        window.location.assign(result.url);
        return;
      }
      const result = await api("/sync", { request_id: crypto.randomUUID() });
      setStatus((s) => (s ? { ...s, run: result.run } : s));
      await refresh();
      await changed();
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Email scan failed.");
      await refresh();
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  async function disconnect() {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api("/disconnect", {});
      setNotice(result.message);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not disconnect.");
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  async function reviewed() {
    await refresh();
    await changed();
  }
  async function more(kind = "pending") {
    try {
      const result = await api(
        "/candidates?status=" +
          kind +
          "&offset=" +
          (status?.candidates.filter(
            (c) =>
              c.review_status === kind &&
              (kind !== "approved" || c.payment_status !== "refund"),
          ).length ?? 0),
      );
      setStatus((s) =>
        s
          ? {
              ...s,
              candidates: [
                ...s.candidates,
                ...result.candidates.filter(
                  (c: ReviewCandidate) =>
                    !s.candidates.some((x) => x.id === c.id),
                ),
              ],
            }
          : s,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load review queue.");
    }
  }
  const run = status?.run,
    pending =
      status?.candidates.filter((c) => c.review_status === "pending") ?? [],
    saved =
      status?.candidates.filter(
        (c) => c.review_status === "approved" && c.payment_status !== "refund",
      ) ?? [];
  return (
    <section
      className="gmail-card card"
      aria-label="Gmail Expense Sync"
      aria-busy={active}
    >
      <div className="gmail-heading">
        <span className="gmail-icon">
          <Mail size={23} />
        </span>
        <div>
          <h2>Gmail Expense Sync</h2>
          <p>Retrieve expenses from the last 7 days.</p>
        </div>
      </div>
      {loading ? (
        <p role="status">Loading connection status…</p>
      ) : (
        <>
          <p className="gmail-account">
            {connected
              ? status?.connection?.email
              : status?.connection?.connection_status === "reconnect_required"
                ? "Authorization expired · Reconnect Gmail"
                : "Gmail is not connected"}
          </p>
          <p className="gmail-meta">
            Last successful sync:{" "}
            {status?.connection?.last_sync_at
              ? new Date(status.connection.last_sync_at).toLocaleString()
              : "Never"}
          </p>
          <div className="gmail-counts">
            <span>
              <b>{run?.imported_count ?? 0}</b> New
            </span>
            <span>
              <b>{run?.duplicate_count ?? 0}</b> Duplicates
            </span>
            <span>
              <b>{run?.review_count ?? 0}</b> Review
            </span>
          </div>
          {!status?.configured && (
            <p className="gmail-warning">
              Gmail setup is incomplete. Configure Google OAuth and the server
              environment before connecting.
            </p>
          )}
          <button
            className="gmail-primary"
            onClick={() => void retrieve()}
            disabled={active || !status?.configured}
          >
            {active ? (
              <>
                <RefreshCw size={18} className="gmail-spinner" />
                Scanning email…
              </>
            ) : (
              <>
                <Mail size={18} />
                Retrieve Email Data
              </>
            )}
          </button>
          <p className="gmail-safety">
            <ShieldCheck size={14} /> Read-only access. Scans start only when
            you press Retrieve.
          </p>
          {status?.connection &&
            status.connection.connection_status !== "disconnected" && (
              <button
                className="gmail-link"
                disabled={busy}
                onClick={() => void disconnect()}
              >
                <Unplug size={14} />
                Disconnect Gmail
              </button>
            )}
          {run && (
            <button
              className="gmail-link"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
            >
              {open ? "Hide scan details" : "View scan results and review"}
              {pending.length ? ` · ${pending.length} pending` : ""}
            </button>
          )}
          {open && run && (
            <div className="gmail-results" aria-live="polite">
              <h3>
                {run.status === "completed"
                  ? "Email Scan Completed"
                  : run.status === "running" && status?.active
                    ? "Email Scan in Progress"
                    : run.status === "partial"
                      ? "Email Scan Partially Completed"
                      : run.status === "cancelled"
                        ? "Email Scan Cancelled"
                        : "Email Scan Interrupted"}
              </h3>
              <dl className="gmail-result-grid">
                <div>
                  <dt>Emails scanned</dt>
                  <dd>{run.scanned_count}</dd>
                </div>
                <div>
                  <dt>New expenses saved</dt>
                  <dd>{run.imported_count}</dd>
                </div>
                <div>
                  <dt>Duplicates skipped</dt>
                  <dd>{run.duplicate_count}</dd>
                </div>
                <div>
                  <dt>Pending review</dt>
                  <dd>{run.review_count}</dd>
                </div>
                <div>
                  <dt>Could not be interpreted / retrieved</dt>
                  <dd>{run.failed_count}</dd>
                </div>
                <div>
                  <dt>Non-spending / unrelated</dt>
                  <dd>{run.ignored_count}</dd>
                </div>
              </dl>
              <div className="gmail-totals">
                <b>{money(cents(run.myr_total), "MYR")}</b>
                <b>{money(cents(run.sgd_total), "SGD")}</b>
              </div>
              <p>{run.message}</p>
              {run.status === "completed" &&
                !run.imported_count &&
                !run.review_count && (
                  <p>
                    No new valid expense was found. Existing expenses remain
                    unchanged.
                  </p>
                )}
              <p className="gmail-meta">
                Totals above cover newly saved expenses in this scan. Pending
                records are excluded. The latest 30 other audit records are
                shown here. Pending and saved expenses can be loaded in pages;
                all saved transactions remain in Transactions and CSV.
              </p>
              {!!pending.length && <h3>Transactions pending review</h3>}
              {pending.map((c) => (
                <Review
                  key={c.id}
                  candidate={c}
                  data={data}
                  changed={reviewed}
                />
              ))}
              {pending.length < (status?.pending_count ?? 0) && (
                <button className="gmail-link" onClick={() => void more()}>
                  Load more pending transactions (
                  {status!.pending_count - pending.length} remaining)
                </button>
              )}
              {!!saved.length && (
                <details>
                  <summary>Review saved expenses · {saved.length}</summary>
                  {saved.map((c) => (
                    <Review
                      key={c.id}
                      candidate={c}
                      data={data}
                      changed={reviewed}
                    />
                  ))}
                  {saved.length < (status?.saved_count ?? 0) && (
                    <button
                      className="gmail-link"
                      onClick={() => void more("approved")}
                    >
                      Load more saved expenses
                    </button>
                  )}
                </details>
              )}
              <details>
                <summary>Duplicate and non-spending evidence</summary>
                {status?.candidates
                  .filter(
                    (c) =>
                      ["duplicate", "ignored", "rejected"].includes(
                        c.review_status,
                      ) ||
                      (c.review_status === "approved" &&
                        c.payment_status === "refund"),
                  )
                  .map((c) => (
                    <div className="gmail-evidence" key={c.id}>
                      <b>
                        {c.merchant || c.source} · {c.review_status}
                      </b>
                      <p>{c.reason}</p>
                      <small>
                        {c.subject}
                        <br />
                        Message: {c.gmail_message_id}
                        {c.transaction_id && (
                          <>
                            <br />
                            Linked entry: {c.transaction_id}
                          </>
                        )}
                      </small>
                    </div>
                  ))}
              </details>
            </div>
          )}
        </>
      )}
      {notice && (
        <p role="status" className="gmail-notice">
          {notice}
        </p>
      )}
      {error && (
        <div role="alert" className="gmail-warning">
          {error}
          <button className="gmail-link" onClick={() => void refresh()}>
            Reload status
          </button>
        </div>
      )}
    </section>
  );
}
function Review({
  candidate: c,
  data,
  changed,
}: {
  candidate: ReviewCandidate;
  data: Data;
  changed: () => Promise<void>;
}) {
  const cats = data.categories.filter((x) => x.transaction_type === "expense"),
    [category, setCategory] = useState(
      c.category_id ?? cats.find((x) => x.name === "Other")?.id ?? "",
    ),
    [amount, setAmount] = useState(c.amount ?? ""),
    [currency, setCurrency] = useState<Currency | "">(
      c.currency === "SGD" || c.currency === "MYR" ? c.currency : "",
    ),
    [date, setDate] = useState(c.transaction_date ?? ""),
    [merchant, setMerchant] = useState(c.merchant),
    [target, setTarget] = useState(""),
    [separate, setSeparate] = useState(false),
    [crossCurrency, setCrossCurrency] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const gate = useRef(false);
  const pending = c.review_status === "pending";
  const options = data.transactions
    .filter(
      (t) =>
        t.transaction_type === "expense" &&
        (c.payment_status === "refund" || t.semantic_type !== "refund") &&
        (crossCurrency || t.currency === currency),
    )
    .slice()
    .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date));
  async function submit(action: string) {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setError("");
    try {
      await api("/review", {
        id: c.id,
        action,
        category_id: category || null,
        ...(action === "reject" || action === "category"
          ? {}
          : {
              target_id: target || null,
              amount: amount || undefined,
              currency,
              date: date || undefined,
              merchant,
              separate,
              cross_currency: crossCurrency,
            }),
      });
      await changed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review could not be saved.");
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  const blocked = [
    "pending",
    "hold",
    "cancelled",
    "topup",
    "transfer",
  ].includes(c.payment_status);
  return (
    <details className="gmail-review">
      <summary>
        {c.merchant || c.source} ·{" "}
        {c.amount ? `${c.currency ?? "?"} ${c.amount}` : "Confirm amount"}{" "}
        <span>{c.review_status}</span>
      </summary>
      <p className="gmail-warning">
        {c.reason || `Verified ${c.payment_status} expense`}
      </p>
      <div className="gmail-evidence">
        <b>{c.subject}</b>
        <p>From: {c.sender}</p>
        <small>
          Source: {c.source} · Status: {c.payment_status}
          <br />
          Message: {c.gmail_message_id}
          <br />
          Reference: {c.reference ?? "Unavailable"}
          <br />
          Received:{" "}
          {c.received_at ? new Date(c.received_at).toLocaleString() : "Unknown"}
          <br />
          Confidence: {Math.round(Number(c.confidence) * 100)}%
        </small>
        {Array.isArray(c.evidence?.detected_amounts) && (
          <p>
            Detected:{" "}
            {(
              c.evidence.detected_amounts as {
                symbol: string;
                amount: string | null;
              }[]
            )
              .map((a) => `${a.symbol} ${a.amount ?? "?"}`)
              .join(", ")}
          </p>
        )}
        <a href="https://mail.google.com/" target="_blank" rel="noreferrer">
          Inspect original email in Gmail
        </a>
      </div>
      {pending && (
        <>
          <label>
            Merchant
            <input
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              maxLength={200}
            />
          </label>
          <div className="gmail-form-grid">
            <label>
              Settled amount
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </label>
            <label>
              Currency
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency | "")}
              >
                <option value="">Verify currency</option>
                <option>MYR</option>
                <option>SGD</option>
              </select>
            </label>
          </div>
          <label>
            Transaction date
            <input
              type="date"
              value={date}
              max={today()}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          {!c.currency && (
            <p className="gmail-warning">
              Currency requires verification against the actual payment account.
              Selecting a currency does not convert the amount.
            </p>
          )}
        </>
      )}
      <label>
        Expense category
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {cats.map((x) => (
            <option value={x.id} key={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      {pending ? (
        <>
          {c.payment_status !== "refund" && (
            <label className="gmail-checkbox">
              <input
                type="checkbox"
                checked={crossCurrency}
                onChange={(e) => {
                  setCrossCurrency(e.target.checked);
                  setTarget("");
                }}
              />
              I verified this is the same purchase with a foreign-currency
              settlement. Link its evidence without converting amounts or adding
              another expense.
            </label>
          )}
          <label>
            Link existing purchase (duplicate / refund)
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Choose existing expense</option>
              {options.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.transaction_date} ·{" "}
                  {t.semantic_type === "refund" ? "Refund: " : ""}
                  {t.description} · {t.currency} {t.amount}
                </option>
              ))}
            </select>
          </label>
          <label className="gmail-checkbox">
            <input
              type="checkbox"
              checked={separate}
              onChange={(e) => setSeparate(e.target.checked)}
            />
            I checked the original email and confirm this is a separate
            completed purchase or separate refund.
          </label>
          <div className="gmail-actions">
            {c.payment_status === "refund" ? (
              <button
                disabled={busy || !target}
                onClick={() => void submit("refund")}
              >
                Apply verified refund
              </button>
            ) : (
              <button
                disabled={busy || blocked}
                onClick={() => void submit("approve")}
              >
                Approve corrected expense
              </button>
            )}
            <button
              disabled={busy || !target}
              onClick={() => void submit("duplicate")}
            >
              Link as duplicate
            </button>
            <button disabled={busy} onClick={() => void submit("reject")}>
              Reject
            </button>
          </div>
          {blocked && (
            <p>
              This is not a completed expense. Reject it or link it to an
              already recorded purchase; a later completed-payment receipt can
              be imported separately.
            </p>
          )}
        </>
      ) : (
        <button
          className="gmail-link"
          disabled={busy}
          onClick={() => void submit("category")}
        >
          Save category
        </button>
      )}
      {error && (
        <p className="gmail-warning" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
