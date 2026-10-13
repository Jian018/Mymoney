"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  Building2,
  ShoppingBag,
  Wallet,
  ShieldCheck,
  ChevronRight,
  RefreshCw,
  FileUp,
} from "lucide-react";
import type { Data } from "@/lib/finance";
import { requestedHistory } from "@/lib/import/dates";
import type { ImportItem, ImportResult, Source } from "@/lib/import/types";
async function request(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Import failed");
  return data;
}
export function AutoImport({
  data,
  changed,
}: {
  data: Data;
  changed: () => Promise<void>;
}) {
  const [sources, setSources] = useState<Source[]>([]),
    [selected, setSelected] = useState<Source | null>(null),
    [items, setItems] = useState<ImportItem[]>([]),
    [result, setResult] = useState<ImportResult | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [csv, setCsv] = useState(""),
    [filename, setFilename] = useState(""),
    [account, setAccount] = useState(""),
    [confirm, setConfirm] = useState(false);
  const range = requestedHistory();
  const detail = useRef<HTMLElement>(null);
  const selectedId = selected?.id;
  useEffect(() => {
    if (selectedId)
      detail.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [selectedId]);
  const load = useCallback(async () => {
    const state = await request("/api/imports");
    setSources(state.sources);
    setItems(state.items);
    setLoaded(true);
    setSelected((s) =>
      s ? (state.sources.find((v: Source) => v.id === s.id) ?? null) : null,
    );
  }, []);
  useEffect(() => {
    let active = true;
    request("/api/imports")
      .then((state) => {
        if (active) {
          setSources(state.sources);
          setItems(state.items);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function action(run: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await run();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }
  const select = (source: Source) => {
    setSelected(source);
    setCsv("");
    setFilename("");
    setAccount("");
    setConfirm(false);
    setResult(null);
    setError("");
    setNotice("");
  };
  return (
    <div className="import-hub">
      <div className="import-intro">
        <span className="import-mark">
          <ArrowDownToLine size={25} />
        </span>
        <div>
          <span className="eyebrow">YOUR SOURCES, ONE LEDGER</span>
          <h2>A clearer money trail.</h2>
          <p>
            Bring in transactions when you choose. We check for repeats before
            they count.
          </p>
        </div>
      </div>
      <div className="import-trust">
        <ShieldCheck size={19} />
        <span>No bank passwords or OTPs. Every sync starts with your tap.</span>
      </div>
      <div className="import-period">
        <span>Previous 7 calendar days</span>
        <strong>
          {range.from} → {range.to}
        </strong>
        <small>MYR & SGD · Asia/Singapore</small>
      </div>
      {error && (
        <div className="alert" role="alert">
          {error}
          <button disabled={busy} onClick={() => void action(load)}>
            Retry
          </button>
        </div>
      )}
      {notice && (
        <div className="import-notice" role="status">
          {notice}
        </div>
      )}
      {!loaded && !error && <p aria-busy="true">Loading your sources…</p>}
      {(["Banks", "Wallets", "Shopping", "Other"] as const).map(
        (group) =>
          sources.some((s) => s.group === group) && (
            <section key={group}>
              <div className="section-heading">
                <h2>{group}</h2>
                <small>
                  {sources.filter((s) => s.group === group).length} sources
                </small>
              </div>
              <div className="source-grid">
                {sources
                  .filter((s) => s.group === group)
                  .map((source) => (
                    <button
                      key={source.id}
                      className={`source-card ${selected?.id === source.id ? "selected" : ""}`}
                      aria-pressed={selected?.id === source.id}
                      disabled={busy}
                      onClick={() => select(source)}
                    >
                      <span className="source-icon">
                        {group === "Banks" ? (
                          <Building2 size={21} />
                        ) : group === "Shopping" ? (
                          <ShoppingBag size={21} />
                        ) : (
                          <Wallet size={21} />
                        )}
                      </span>
                      <strong>{source.name}</strong>
                      <small
                        className={`source-status ${source.status === "Available" ? "available" : ""}`}
                      >
                        {source.status}
                      </small>
                      <ChevronRight size={14} className="source-chevron" />
                    </button>
                  ))}
              </div>
            </section>
          ),
      )}
      {selected && (
        <section
          ref={detail}
          className="card import-detail"
          aria-label={`${selected.name} import`}
        >
          <div className="section-heading">
            <h2>{selected.name}</h2>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => setSelected(null)}
            >
              Close
            </button>
          </div>
          <p>{selected.detail}</p>
          {selected.docs && (
            <a href={selected.docs} target="_blank" rel="noreferrer">
              Official provider documentation ↗
            </a>
          )}
          {selected.status === "Unsupported" ? (
            <p>No connection or importer is available for this source.</p>
          ) : (
            <>
              {selected.id === "paypal" &&
                selected.status === "Authorization Required" && (
                  <div className="import-auth">
                    <label>
                      <input
                        type="checkbox"
                        checked={confirm}
                        onChange={(e) => setConfirm(e.target.checked)}
                        disabled={busy}
                      />{" "}
                      This configured live app belongs to my own PayPal Business
                      account.
                    </label>
                    <button
                      className="primary-button"
                      disabled={busy || !confirm}
                      onClick={() =>
                        void action(async () => {
                          const v = await request("/api/imports/authorize", {
                            provider: "paypal",
                            confirmBusiness: true,
                          });
                          setNotice(v.message);
                          await load();
                        })
                      }
                    >
                      Authorize business API
                    </button>
                    <small>
                      Official OAuth2 client credentials on the server. No
                      account password is entered here.
                    </small>
                  </div>
                )}
              {selected.id === "paypal" && selected.status === "Available" && (
                <div className="import-auth">
                  <p>
                    OAuth reporting scope verified. A successful history request
                    is still required; this does not connect a personal PayPal
                    wallet.
                  </p>
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        setResult(
                          await request("/api/imports", {
                            mode: "sync",
                            source: "paypal",
                            request_id: crypto.randomUUID(),
                          }),
                        );
                        await Promise.all([load(), changed()]);
                      })
                    }
                  >
                    <RefreshCw size={17} />{" "}
                    {busy ? "Requesting history…" : "Sync previous 7 days"}
                  </button>
                </div>
              )}
              <h3>Import a CSV statement</h3>
              <p className="import-help">
                Use our template: date, positive amount, currency, merchant and
                type (expense, income, refund, transfer or topup). Native bank
                files and PDF require conversion first. Keep a consistent
                account label and provider transaction IDs.
              </p>
              <a
                className="import-template"
                href="/import-template.csv"
                download
              >
                <ArrowDownToLine size={16} /> Download CSV template
              </a>
              <label className="import-field">
                Account label
                <input
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  maxLength={100}
                  placeholder="e.g. Maybank savings · 1234"
                  disabled={busy}
                />
              </label>
              <label className="import-file">
                <FileUp size={22} />
                <strong>{filename || "Choose CSV statement"}</strong>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 2_000_000) {
                      setError("CSV limit is 2 MB.");
                      return;
                    }
                    void action(async () => {
                      setCsv(await file.text());
                      setFilename(file.name);
                      setResult(null);
                    });
                  }}
                />
              </label>
              <small className="import-help">
                Only explicit RM/MYR and S$/SGD are recognized. Bare $ is sent
                for review. The file alone cannot verify complete seven-day
                coverage.
              </small>
              <button
                className="primary-button"
                disabled={busy || !csv || !account.trim()}
                onClick={() =>
                  void action(async () => {
                    setResult(
                      await request("/api/imports", {
                        mode: "statement",
                        source: selected.id,
                        account: account.trim(),
                        csv,
                        request_id: crypto.randomUUID(),
                      }),
                    );
                    await Promise.all([load(), changed()]);
                  })
                }
              >
                {busy ? "Checking transactions…" : "Import & check duplicates"}
              </button>
            </>
          )}
        </section>
      )}
      {result && (
        <section className="card import-result" role="status">
          <h2>Import complete</h2>
          <div className="import-counts">
            <div>
              <strong>{result.new}</strong>
              <span>New</span>
            </div>
            <div>
              <strong>{result.duplicate}</strong>
              <span>Duplicate</span>
            </div>
            <div>
              <strong>{result.pending}</strong>
              <span>Review</span>
            </div>
            <div>
              <strong>{result.excluded}</strong>
              <span>Excluded</span>
            </div>
          </div>
          <p>{result.history}</p>
          <small>
            Pending and excluded records do not affect your balance. Counts
            describe this import at completion.
          </small>
        </section>
      )}
      <section>
        <div className="section-heading">
          <h2>Review queue</h2>
          <span className="pill">
            {items.length}
            {items.length === 100 ? "+" : ""}
          </span>
        </div>
        <p className="import-help">
          Similar amounts and dates can represent separate purchases. Match
          duplicates, approve a separate entry, link a refund, or exclude money
          movement.
        </p>
        {!items.length && loaded ? (
          <div className="card empty">
            <ShieldCheck size={25} />
            <p>Nothing waiting for review.</p>
          </div>
        ) : (
          items.map((item) => (
            <Review
              key={item.id}
              item={item}
              data={data}
              busy={busy}
              submit={(body) =>
                action(async () => {
                  await request("/api/imports/review", body);
                  await Promise.all([load(), changed()]);
                  setNotice("Review saved. Your ledger has been updated.");
                })
              }
            />
          ))
        )}
      </section>
    </div>
  );
}
function Review({
  item,
  data,
  busy,
  submit,
}: {
  item: ImportItem;
  data: Data;
  busy: boolean;
  submit: (body: unknown) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false),
    [kind, setKind] = useState<"expense" | "income">(
      item.flow === "income" ? "income" : "expense",
    ),
    [decision, setDecision] = useState("new");
  const candidates = data.transactions;
  return (
    <article className="card review-item">
      <button
        className="review-toggle"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <div>
          <strong>{item.merchant || "Unknown merchant"}</strong>
          <small>
            {item.source} · {item.account} ·{" "}
            {item.transaction_date || "Date missing"}
          </small>
        </div>
        <span>
          {item.currency || "?"} {item.amount || "?"}
        </span>
      </button>
      <p>{item.reason}</p>
      {(!item.amount || !item.currency || !item.transaction_date) && (
        <p>
          Original statement: {item.original_date || "—"} ·{" "}
          {item.original_currency || "—"} {item.original_amount || "—"}
        </p>
      )}
      {expanded && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void submit({
              item: item.id,
              action: decision,
              separate_refund: f.get("separate_refund") === "on",
              ...(decision === "exclude"
                ? {}
                : {
                    date: String(f.get("date")),
                    amount: String(f.get("amount")),
                    currency: String(f.get("currency")),
                    merchant: String(f.get("merchant")),
                    kind,
                    ...(decision === "new"
                      ? { category: String(f.get("category")) }
                      : { target: String(f.get("target")) }),
                  }),
            });
          }}
        >
          <label className="import-field">
            Decision
            <select
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
            >
              <option value="new">Separate transaction</option>
              <option value="duplicate">
                Already counted — match original
              </option>
              <option value="refund">Refund — reduce original expense</option>
              <option value="exclude">
                Exclude top-up, transfer or irrelevant record
              </option>
            </select>
          </label>
          {decision !== "exclude" && (
            <>
              <div className="import-form-grid">
                <label className="import-field">
                  Date
                  <input
                    name="date"
                    type="date"
                    defaultValue={item.transaction_date ?? ""}
                    required
                  />
                </label>
                <label className="import-field">
                  Currency
                  <select
                    name="currency"
                    defaultValue={item.currency ?? ""}
                    required
                  >
                    <option value="" disabled>
                      Choose
                    </option>
                    <option>MYR</option>
                    <option>SGD</option>
                  </select>
                </label>
              </div>
              <label className="import-field">
                Amount
                <input
                  name="amount"
                  inputMode="decimal"
                  pattern="[0-9]{1,12}(\.[0-9]{1,2})?"
                  defaultValue={item.amount ?? ""}
                  required
                />
              </label>
              <label className="import-field">
                Merchant
                <input
                  name="merchant"
                  defaultValue={item.merchant}
                  maxLength={200}
                  required
                />
              </label>
              {decision === "new" ? (
                <>
                  <label className="import-field">
                    Type
                    <select
                      value={kind}
                      onChange={(e) =>
                        setKind(e.target.value as "expense" | "income")
                      }
                    >
                      <option value="expense">Expense</option>
                      <option value="income">Income</option>
                    </select>
                  </label>
                  <label className="import-field">
                    Category
                    <select name="category" key={kind} required defaultValue="">
                      <option value="" disabled>
                        Choose category
                      </option>
                      {data.categories
                        .filter((c) => c.transaction_type === kind)
                        .map((c) => (
                          <option value={c.id} key={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </>
              ) : (
                <label className="import-field">
                  Original transaction
                  <select name="target" defaultValue="" required>
                    <option value="" disabled>
                      Choose original
                    </option>
                    {candidates
                      .filter(
                        (t) =>
                          decision !== "refund" ||
                          (t.transaction_type === "expense" &&
                            t.semantic_type !== "refund"),
                      )
                      .map((t) => (
                        <option value={t.id} key={t.id}>
                          {item.candidate_ids.includes(t.id)
                            ? "Suggested · "
                            : ""}
                          {t.semantic_type === "refund" ? "Refund · " : ""}
                          {t.transaction_date} · {t.description || "Cash"} ·{" "}
                          {t.currency} {t.amount}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            </>
          )}
          {decision === "refund" && (
            <label className="import-field">
              <span>
                <input type="checkbox" name="separate_refund" /> This is a
                separate refund, even if a similar refund is already recorded.
              </span>
            </label>
          )}
          <button className="primary-button" disabled={busy}>
            {busy ? "Saving…" : "Confirm review"}
          </button>
        </form>
      )}
    </article>
  );
}
