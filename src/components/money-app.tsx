"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  ChevronRight,
  Check,
  CircleCheck,
  Download,
  Flame,
  Home,
  List,
  Plus,
  Settings,
  ChartNoAxesColumnIncreasing,
  X,
  Utensils,
  Car,
  ShoppingBag,
  Receipt,
  Clapperboard,
  Wallet,
  Ellipsis,
  Pencil,
  Trash2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  budgetSpent,
  cents,
  decimal,
  localTime,
  money,
  percentage,
  shiftDate,
  streaks,
  thresholdCrossed,
  today,
  total,
  transactionCsv,
} from "@/lib/finance";
import type {
  Budget,
  Category,
  Currency,
  Data,
  Kind,
  Transaction,
} from "@/lib/finance";
import { PwaStatus, ViewportBridge } from "./pwa";

type Tab = "Home" | "Transactions" | "Reports" | "Settings";
type Sheet =
  | "transaction"
  | "checkin"
  | "budget"
  | "categories"
  | "preferences"
  | "export"
  | "account"
  | "notifications"
  | "budget-alert"
  | null;
const icons: Record<string, LucideIcon> = {
  food: Utensils,
  transport: Car,
  shopping: ShoppingBag,
  bills: Receipt,
  entertainment: Clapperboard,
  salary: Wallet,
  other: Ellipsis,
};
const dateLabel = (date: string) =>
  new Date(date + "T12:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
async function api(path: string, method = "GET", body?: unknown) {
  if (!navigator.onLine)
    throw new Error("You are offline. Connect to save or load records.");
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Request failed. Please retry.");
  return data;
}
function Icon({ category }: { category?: Category }) {
  const Component = icons[category?.icon ?? "other"] ?? Ellipsis;
  return (
    <span className="category-icon" style={{ color: category?.color }}>
      <Component size={20} />
    </span>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="empty">
      <Wallet size={25} />
      <p>{children}</p>
    </div>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null),
    previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement;
    container.current?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") close();
      if (event.key !== "Tab") return;
      const focusable = container.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]",
      );
      if (!focusable?.length) return;
      const first = focusable[0],
        last = focusable[focusable.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === container.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previousFocus.current?.focus();
    };
  }, [close]);
  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        tabIndex={-1}
        ref={container}
      >
        <div className="grabber" />
        <header className="modal-header">
          <h2 id="sheet-title">{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={close}
          >
            <X size={22} />
          </button>
        </header>
        <div className="modal-content">{children}</div>
      </div>
    </div>
  );
}
function TransactionRows({
  rows,
  categories,
  edit,
}: {
  rows: Transaction[];
  categories: Category[];
  edit: (row: Transaction) => void;
}) {
  return rows.length ? (
    <div className="transaction-list">
      {rows.map((row) => {
        const category = categories.find((c) => c.id === row.category_id);
        return (
          <button
            key={row.id}
            className="transaction-row"
            onClick={() => edit(row)}
          >
            <Icon category={category} />
            <span className="transaction-info">
              <strong>{category?.name ?? "Category"}</strong>
              <small>
                {row.description || dateLabel(row.transaction_date)}
                {row.description ? " · " + dateLabel(row.transaction_date) : ""}
              </small>
            </span>
            <span
              className={
                "transaction-value " +
                (row.transaction_type === "income" ? "positive" : "")
              }
            >
              <strong>
                {row.transaction_type === "income" ? "+" : "−"}
                {money(cents(row.amount), row.currency)}
              </strong>
              <small>{row.currency}</small>
            </span>
          </button>
        );
      })}
    </div>
  ) : (
    <Empty>No transactions yet. Your first entry starts here.</Empty>
  );
}
function BudgetCard({
  budget,
  data,
  onEdit,
}: {
  budget: Budget;
  data: Data;
  onEdit?: () => void;
}) {
  const spent = budgetSpent(budget, data.transactions),
    limit = cents(budget.limit_amount),
    percent = percentage(spent, limit);
  const warning = percent >= 100 ? "over" : percent >= 80 ? "warning" : "";
  return (
    <button
      className={"card budget-card " + warning}
      onClick={onEdit}
      disabled={!onEdit}
    >
      <div className="row">
        <strong>
          {budget.category_id
            ? data.categories.find((c) => c.id === budget.category_id)?.name
            : "Monthly budget"}
        </strong>
        <span className="pill">{percent.toFixed(0)}% used</span>
      </div>
      <div className="progress">
        <span style={{ width: Math.min(percent, 100) + "%" }} />
      </div>
      <div className="row small">
        <span>{money(spent, budget.currency)} spent</span>
        <span>{money(limit, budget.currency)}</span>
      </div>
      <p>
        {percent >= 100
          ? "Over budget by " + money(spent - limit, budget.currency)
          : money(limit - spent, budget.currency) + " left to spend"}
        {percent >= 80 && percent < 100
          ? " · Approaching your limit"
          : percent >= 50 && percent < 80
            ? " · Halfway through"
            : ""}
      </p>
    </button>
  );
}
export default function MoneyApp({ deviceId }: { deviceId: string }) {
  const [data, setData] = useState<Data | null>(null),
    [tab, setTab] = useState<Tab>("Home"),
    [currency, setCurrency] = useState<Currency>("MYR");
  const [sheet, setSheet] = useState<Sheet>(null),
    [editing, setEditing] = useState<Transaction | null>(null),
    [editingBudget, setEditingBudget] = useState<Budget | null>(null),
    [entryKind, setEntryKind] = useState<Kind>("expense");
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [warning, setWarning] = useState("");
  const [checkDate, setCheckDate] = useState(today()),
    [clock, setClock] = useState(Date.now()),
    [dismissed, setDismissed] = useState("");
  const [filter, setFilter] = useState({
    type: "",
    category: "",
    from: "",
    to: "",
  });
  const [reportMonth, setReportMonth] = useState(today().slice(0, 7));
  const submitting = useRef(false),
    initialized = useRef(false),
    draftId = useRef("");
  const close = useCallback(() => {
    if (!submitting.current) {
      setSheet(null);
      setError("");
      setDismissed(today());
    }
  }, []);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = (await api("/api/data")) as Data;
      setData(result);
      setError("");
      if (!initialized.current) {
        initialized.current = true;
        setCurrency(result.profile.default_currency);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load records");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => setClock(Date.now()), 30000);
    const visible = () => {
      setClock(Date.now());
      if (document.visibilityState === "visible") void refresh();
    };
    const connected = () => void refresh();
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", connected);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", connected);
    };
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  const date = today(new Date(clock)),
    month = date.slice(0, 7),
    yesterday = shiftDate(date, -1);
  const doneToday = Boolean(
    data?.checkins.some((c) => c.checkin_date === date),
  );
  const pendingYesterday = Boolean(
    data && !data.checkins.some((c) => c.checkin_date === yesterday),
  );
  useEffect(() => {
    if (!data || sheet || dismissed === date) return;
    if (
      new URLSearchParams(window.location.search).has("checkin") ||
      (data.preferences.daily_reminder_enabled &&
        !doneToday &&
        localTime(new Date(clock)) >=
          data.preferences.reminder_time.slice(0, 5))
    ) {
      setCheckDate(date);
      setSheet("checkin");
      window.history.replaceState({}, "", "/");
    }
  }, [data, sheet, dismissed, date, clock, doneToday]);
  const openTransaction = (
    kind: Kind = "expense",
    transaction: Transaction | null = null,
  ) => {
    draftId.current = crypto.randomUUID();
    setEditing(transaction);
    setEntryKind(transaction?.transaction_type ?? kind);
    setError("");
    setSheet("transaction");
  };
  const openCheck = (day = date) => {
    setCheckDate(day);
    setError("");
    setSheet("checkin");
  };
  async function mutate(
    body: unknown,
    method = "POST",
    message = "Saved successfully.",
  ) {
    if (submitting.current) return false;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await api("/api/records", method, body);
      setToast(message);
      setSheet(null);
      await refresh();
      return true;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Unable to save. Retry when connected.",
      );
      return false;
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function saveTransaction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fields = {
      entity: "transaction",
      id: editing?.id,
      request_id: editing ? undefined : draftId.current,
      transaction_type: entryKind,
      amount: String(form.get("amount")),
      currency: String(form.get("currency")) as Currency,
      category_id: String(form.get("category_id")),
      transaction_date: String(form.get("transaction_date")),
      description: String(form.get("description")),
    };
    let amount: bigint;
    try {
      amount = cents(fields.amount);
      if (!amount) throw new Error("Enter an amount greater than zero.");
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const alerts: string[] = [];
    if (data && fields.transaction_type === "expense")
      for (const budget of data.budgets) {
        if (
          budget.currency !== fields.currency ||
          budget.month.slice(0, 7) !== fields.transaction_date.slice(0, 7) ||
          (budget.category_id && budget.category_id !== fields.category_id)
        )
          continue;
        const before = budgetSpent(budget, data.transactions);
        const afterRows = data.transactions.filter((t) => t.id !== editing?.id);
        afterRows.push({
          ...fields,
          id: editing?.id ?? "new",
          amount: decimal(amount),
        });
        const after = budgetSpent(budget, afterRows),
          threshold = thresholdCrossed(
            before,
            after,
            cents(budget.limit_amount),
          );
        if (threshold)
          alerts.push(
            `${budget.category_id ? data.categories.find((c) => c.id === budget.category_id)?.name : "Overall"} ${budget.currency} budget has reached ${threshold}%. ${money(after, budget.currency)} spent of ${money(cents(budget.limit_amount), budget.currency)}.`,
          );
      }
    if (
      await mutate(
        fields,
        "POST",
        editing ? "Transaction updated." : "Transaction saved.",
      )
    ) {
      if (alerts.length) {
        setWarning(alerts.join("\n"));
        setSheet("budget-alert");
      }
    }
  }
  const monthRows =
    data?.transactions.filter((t) => t.transaction_date.startsWith(month)) ??
    [];
  const overall = data?.budgets.find(
    (b) =>
      b.month.startsWith(month) && b.currency === currency && !b.category_id,
  );
  const spent = total(monthRows, "expense", currency),
    income = total(monthRows, "income", currency);
  const completion = streaks(data?.checkins ?? [], date);
  const titles: Record<Exclude<Sheet, null>, string> = {
    transaction: editing ? "Edit transaction" : "New transaction",
    checkin: "Daily check-in",
    budget: "Your budgets",
    categories: "Your categories",
    preferences: "Notifications & reminders",
    export: "Export your data",
    account: "Your account",
    notifications: "Notification center",
    "budget-alert": "Budget check",
  };
  return (
    <main className="shell app-shell">
      <ViewportBridge />
      <PwaStatus />
      <div className="app-body" inert={sheet !== null}>
        <header className="app-header">
          <div>
            <p className="eyebrow">
              MY MONEY <span className="tiny-dot" />
            </p>
            <span className="header-date">
              {new Date(date + "T12:00:00Z").toLocaleDateString("en-GB", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </span>
          </div>
          <button
            className="icon-button notification-button"
            aria-label="Open notification center"
            onClick={() => setSheet("notifications")}
          >
            <Bell size={21} />
            {(!doneToday || pendingYesterday) && <i />}
          </button>
        </header>
        <div className="content" key={tab}>
          <div className="title-row">
            <h1>
              {tab === "Home"
                ? `Hello, ${data?.profile.display_name === "My Money" ? "you" : (data?.profile.display_name ?? "you")}.`
                : tab === "Reports"
                  ? "The bigger picture."
                  : tab === "Transactions"
                    ? "Your money moves."
                    : "Make it yours."}
            </h1>
            {tab !== "Settings" && (
              <div className="currency-switch" aria-label="Currency">
                {(["MYR", "SGD"] as const).map((c) => (
                  <button
                    key={c}
                    className={currency === c ? "active" : ""}
                    onClick={() => setCurrency(c)}
                    aria-pressed={currency === c}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="subtitle">
            {tab === "Home"
              ? "A little awareness goes a long way."
              : tab === "Transactions"
                ? "Every entry, a little more clarity."
                : tab === "Reports"
                  ? "Understand the habits behind the numbers."
                  : "A private space, on your terms."}
          </p>
          {error && (
            <div className="alert" role="alert">
              {error}
              <button onClick={() => void refresh()} disabled={loading}>
                <RefreshCw size={15} /> Retry
              </button>
            </div>
          )}
          {loading && !data && (
            <div className="card empty" aria-busy="true">
              Loading your records…
            </div>
          )}
          {data && (
            <>
              {tab === "Home" && (
                <>
                  <div className="balance-card">
                    <div className="row">
                      <span className="eyebrow">
                        {overall ? "AVAILABLE THIS MONTH" : "MONTHLY CASH FLOW"}
                      </span>
                      <span className="light-pill">
                        {new Date(date + "T12:00:00Z").toLocaleDateString(
                          "en-GB",
                          { month: "short", year: "numeric" },
                        )}
                      </span>
                    </div>
                    <h2>
                      {money(
                        overall
                          ? cents(overall.limit_amount) - spent
                          : income - spent,
                        currency,
                      )}
                    </h2>
                    <p>
                      {overall
                        ? "Room to spend, with intention."
                        : "Income minus expenses · Set a budget in Settings."}
                    </p>
                    <div className="balance-divider" />
                    <div className="balance-stats">
                      <div>
                        <span>
                          <ArrowDownLeft size={15} /> Income
                        </span>
                        <strong>{money(income, currency)}</strong>
                      </div>
                      <div>
                        <span>
                          <ArrowUpRight size={15} /> Expenses
                        </span>
                        <strong>{money(spent, currency)}</strong>
                      </div>
                    </div>
                  </div>
                  <div className="quick-actions">
                    <button onClick={() => openTransaction("expense")}>
                      <span className="quick-icon">
                        <ArrowUpRight size={19} />
                      </span>
                      Add expense
                    </button>
                    <button onClick={() => openTransaction("income")}>
                      <span className="quick-icon">
                        <ArrowDownLeft size={19} />
                      </span>
                      Add income
                    </button>
                  </div>
                  <button
                    className={
                      "checkin-banner " + (doneToday ? "completed" : "")
                    }
                    onClick={() =>
                      openCheck(
                        doneToday && pendingYesterday ? yesterday : date,
                      )
                    }
                  >
                    <span className="checkin-icon">
                      {doneToday ? (
                        <CircleCheck size={25} />
                      ) : (
                        <Flame size={25} />
                      )}
                    </span>
                    <span>
                      <strong>
                        {doneToday
                          ? "Today, thoughtfully reviewed."
                          : "Your daily money moment"}
                      </strong>
                      <small>
                        {doneToday
                          ? `${completion.current} day streak · Keep showing up.`
                          : pendingYesterday
                            ? "Yesterday’s review is also waiting."
                            : "One minute to reflect. A calmer tomorrow."}
                      </small>
                    </span>
                    <ChevronRight size={18} />
                  </button>
                  {overall && (
                    <BudgetCard
                      budget={overall}
                      data={data}
                      onEdit={() => {
                        setEditingBudget(overall);
                        setSheet("budget");
                      }}
                    />
                  )}
                  <div className="today-card row">
                    <span>
                      <span className="muted small">TODAY’S SPENDING</span>
                      <strong>
                        {money(
                          total(
                            data.transactions.filter(
                              (t) => t.transaction_date === date,
                            ),
                            "expense",
                            currency,
                          ),
                          currency,
                        )}
                      </strong>
                    </span>
                    <span className="today-icon">
                      <Receipt size={22} />
                    </span>
                  </div>
                  <div className="section-heading">
                    <h2>Recent activity</h2>
                    <button onClick={() => setTab("Transactions")}>
                      See all <ChevronRight size={14} />
                    </button>
                  </div>
                  <div className="card activity">
                    <TransactionRows
                      rows={data.transactions
                        .filter((t) => t.currency === currency)
                        .slice(0, 4)}
                      categories={data.categories}
                      edit={(row) => openTransaction(row.transaction_type, row)}
                    />
                  </div>
                  <p className="footnote">
                    Small steps. Stronger habits. <span>✦</span>
                  </p>
                </>
              )}
              {tab === "Transactions" && (
                <>
                  <div className="card filters">
                    <div className="two-columns">
                      <label>
                        Type
                        <select
                          value={filter.type}
                          onChange={(e) =>
                            setFilter({ ...filter, type: e.target.value })
                          }
                        >
                          <option value="">All transactions</option>
                          <option value="expense">Expenses</option>
                          <option value="income">Income</option>
                        </select>
                      </label>
                      <label>
                        Category
                        <select
                          value={filter.category}
                          onChange={(e) =>
                            setFilter({ ...filter, category: e.target.value })
                          }
                        >
                          <option value="">All categories</option>
                          {data.categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} · {c.transaction_type}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        From
                        <input
                          aria-label="Filter from date"
                          type="date"
                          value={filter.from}
                          onChange={(e) =>
                            setFilter({ ...filter, from: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        To
                        <input
                          aria-label="Filter to date"
                          type="date"
                          value={filter.to}
                          min={filter.from}
                          onChange={(e) =>
                            setFilter({ ...filter, to: e.target.value })
                          }
                        />
                      </label>
                    </div>
                    <button
                      className="text-button"
                      onClick={() =>
                        setFilter({ type: "", category: "", from: "", to: "" })
                      }
                    >
                      Clear filters
                    </button>
                  </div>
                  <div className="section-heading">
                    <h2>{currency} transactions</h2>
                    <button onClick={() => openTransaction()}>
                      <Plus size={17} /> Add
                    </button>
                  </div>
                  <div className="card activity">
                    <TransactionRows
                      rows={data.transactions.filter(
                        (t) =>
                          t.currency === currency &&
                          (!filter.type ||
                            t.transaction_type === filter.type) &&
                          (!filter.category ||
                            t.category_id === filter.category) &&
                          (!filter.from || t.transaction_date >= filter.from) &&
                          (!filter.to || t.transaction_date <= filter.to),
                      )}
                      categories={data.categories}
                      edit={(row) => openTransaction(row.transaction_type, row)}
                    />
                  </div>
                </>
              )}
              {tab === "Reports" && (
                <Reports
                  data={data}
                  currency={currency}
                  month={reportMonth}
                  setMonth={setReportMonth}
                />
              )}
              {tab === "Settings" && (
                <>
                  <div className="card account-card">
                    <span className="avatar">
                      {data.profile.display_name.charAt(0).toUpperCase()}
                    </span>
                    <div>
                      <h2>{data.profile.display_name}</h2>
                      <p className="muted small">Private device access</p>
                    </div>
                    <ShieldCheck size={22} />
                  </div>
                  <div className="section-heading">
                    <h2>YOUR MONEY</h2>
                  </div>
                  <div className="card settings-list">
                    {(
                      [
                        {
                          label: "Budget management",
                          icon: Wallet,
                          target: "budget",
                        },
                        {
                          label: "Categories",
                          icon: List,
                          target: "categories",
                        },
                        {
                          label: "CSV data export",
                          icon: Download,
                          target: "export",
                        },
                      ] as const
                    ).map((item) => (
                      <button
                        key={item.target}
                        onClick={() => {
                          setEditingBudget(null);
                          setSheet(item.target);
                        }}
                      >
                        <item.icon size={20} />
                        <span>{item.label}</span>
                        <ChevronRight size={18} />
                      </button>
                    ))}
                  </div>
                  <div className="section-heading">
                    <h2>YOUR SPACE</h2>
                  </div>
                  <div className="card settings-list">
                    <button onClick={() => setSheet("preferences")}>
                      <Bell size={20} />
                      <span>Notifications & reminders</span>
                      <ChevronRight size={18} />
                    </button>
                    <button onClick={() => openCheck()}>
                      <CircleCheck size={20} />
                      <span>Daily check-in & history</span>
                      <ChevronRight size={18} />
                    </button>
                    <button onClick={() => setSheet("account")}>
                      <Settings size={20} />
                      <span>Account details</span>
                      <ChevronRight size={18} />
                    </button>
                  </div>
                  <div className="card installation">
                    <p className="eyebrow">MADE FOR YOUR IPHONE</p>
                    <h2>Keep clarity close.</h2>
                    <p>
                      Open in Safari → Share → Add to Home Screen. Launch from
                      the icon for the full app and push notifications.
                    </p>
                  </div>
                  <button
                    className="secondary"
                    onClick={() => setSheet("account")}
                  >
                    <ShieldCheck size={18} /> This device is approved
                  </button>
                  <p className="footnote">
                    My Money · v1.0 · Private by design
                  </p>
                </>
              )}
            </>
          )}
        </div>
        <nav className="bottom-nav" aria-label="Main navigation">
          {(
            [
              { title: "Home", Icon: Home },
              { title: "Transactions", Icon: List },
              { title: "Add", Icon: Plus },
              { title: "Reports", Icon: ChartNoAxesColumnIncreasing },
              { title: "Settings", Icon: Settings },
            ] as const
          ).map((item) => (
            <button
              key={item.title}
              className={
                (item.title === "Add" ? "add-tab " : "") +
                (tab === item.title ? "selected" : "")
              }
              aria-current={tab === item.title ? "page" : undefined}
              onClick={() =>
                item.title === "Add" ? openTransaction() : setTab(item.title)
              }
            >
              <span>
                <item.Icon
                  size={item.title === "Add" ? 26 : 21}
                  strokeWidth={tab === item.title ? 2.2 : 1.8}
                />
              </span>
              <small>{item.title}</small>
            </button>
          ))}
        </nav>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {sheet && data && (
        <Modal title={titles[sheet]} close={close}>
          {error && (
            <div role="alert" className="alert">
              {error}
            </div>
          )}
          {sheet === "transaction" && (
            <form onSubmit={saveTransaction} className="form-stack">
              <div className="segmented">
                {(["expense", "income"] as const).map((k) => (
                  <button
                    type="button"
                    key={k}
                    className={entryKind === k ? "active" : ""}
                    onClick={() => setEntryKind(k)}
                  >
                    {k === "expense" ? "Expense" : "Income"}
                  </button>
                ))}
              </div>
              <label className="amount-input">
                Amount
                <input
                  name="amount"
                  autoFocus
                  inputMode="decimal"
                  placeholder="0.00"
                  defaultValue={editing?.amount}
                  required
                  maxLength={15}
                  aria-label="Transaction amount"
                />
              </label>
              <div className="two-columns">
                <label>
                  Currency
                  <select
                    name="currency"
                    defaultValue={editing?.currency ?? currency}
                  >
                    <option>MYR</option>
                    <option>SGD</option>
                  </select>
                </label>
                <label>
                  Date
                  <input
                    name="transaction_date"
                    type="date"
                    defaultValue={editing?.transaction_date ?? date}
                    max={date}
                    required
                  />
                </label>
              </div>
              <label>
                Category
                <select
                  name="category_id"
                  key={entryKind}
                  defaultValue={
                    editing?.transaction_type === entryKind
                      ? editing.category_id
                      : ""
                  }
                  required
                >
                  <option value="" disabled>
                    Select a category
                  </option>
                  {data.categories
                    .filter((c) => c.transaction_type === entryKind)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Description <span className="muted">(optional)</span>
                <input
                  name="description"
                  defaultValue={editing?.description ?? ""}
                  maxLength={500}
                  placeholder="What was it for?"
                />
              </label>
              <button className="primary" disabled={busy}>
                {busy
                  ? "Saving…"
                  : editing
                    ? "Save changes"
                    : "Save " + entryKind}
                <Check size={18} />
              </button>
              {editing && (
                <button
                  type="button"
                  className="danger-button"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Delete this transaction? This cannot be undone.",
                      )
                    )
                      void mutate(
                        { entity: "transaction", id: editing.id },
                        "DELETE",
                        "Transaction deleted.",
                      );
                  }}
                >
                  <Trash2 size={17} /> Delete transaction
                </button>
              )}
              <p className="footnote">
                Online connection required. Your original currency is preserved.
              </p>
            </form>
          )}
          {sheet === "budget-alert" && (
            <div className="form-stack">
              <div className="large-icon">
                <Wallet size={30} />
              </div>
              <h3>A moment to check your pace.</h3>
              <p className="pre-line">{warning}</p>
              <p className="muted">
                Your expense is saved. These reminders help you plan your next
                decision.
              </p>
              <button className="primary" onClick={close}>
                Got it
              </button>
            </div>
          )}
          {sheet === "checkin" && (
            <CheckinForm
              data={data}
              date={checkDate}
              setDate={setCheckDate}
              busy={busy}
              save={mutate}
              addExpense={() => openTransaction("expense")}
            />
          )}
          {sheet === "budget" && (
            <BudgetSettings
              data={data}
              currency={currency}
              editing={editingBudget}
              setEditing={setEditingBudget}
              busy={busy}
              save={mutate}
            />
          )}
          {sheet === "categories" && (
            <CategorySettings data={data} busy={busy} save={mutate} />
          )}
          {sheet === "preferences" && (
            <NotificationSettings
              data={data}
              busy={busy}
              save={mutate}
              refresh={refresh}
              feedback={setToast}
              error={setError}
            />
          )}
          {sheet === "export" && (
            <ExportForm data={data} feedback={setToast} error={setError} />
          )}
          {sheet === "account" && (
            <form
              className="form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void mutate({
                  entity: "profile",
                  display_name: String(f.get("display_name")),
                  default_currency: String(f.get("currency")),
                  timezone: "Asia/Singapore",
                });
              }}
            >
              <label>
                Display name
                <input
                  name="display_name"
                  defaultValue={data.profile.display_name}
                  required
                  maxLength={80}
                />
              </label>
              <label>
                Device ID
                <input value={deviceId} readOnly />
              </label>
              <label>
                Default currency
                <select
                  name="currency"
                  defaultValue={data.profile.default_currency}
                >
                  <option>MYR</option>
                  <option>SGD</option>
                </select>
              </label>
              <label>
                Timezone
                <input value="Asia/Singapore (UTC+08:00)" readOnly />
              </label>
              <button className="primary" disabled={busy}>
                Save account details
              </button>
              <p className="muted small">
                Your device session opens this private ledger automatically. If
                you clear browser data or reinstall the app, approve the new
                Device ID in Supabase to restore access to the same records.
              </p>
            </form>
          )}
          {sheet === "notifications" && (
            <div className="form-stack">
              {pendingYesterday && (
                <button className="notice" onClick={() => openCheck(yesterday)}>
                  <Flame size={20} />
                  <span>
                    <strong>Yesterday is still waiting</strong>
                    <small>
                      Review {dateLabel(yesterday)} and close the loop.
                    </small>
                  </span>
                  <ChevronRight size={18} />
                </button>
              )}
              {!doneToday && (
                <button className="notice" onClick={() => openCheck()}>
                  <CircleCheck size={20} />
                  <span>
                    <strong>Today’s daily check-in</strong>
                    <small>{dateLabel(date)} · A minute for your money</small>
                  </span>
                  <ChevronRight size={18} />
                </button>
              )}
              {data.budgets
                .filter(
                  (b) =>
                    b.month.startsWith(month) &&
                    percentage(
                      budgetSpent(b, data.transactions),
                      cents(b.limit_amount),
                    ) >= 50,
                )
                .map((b) => (
                  <BudgetCard key={b.id} budget={b} data={data} />
                ))}
              <h3>Push activity</h3>
              {data.notifications.length ? (
                data.notifications.slice(0, 20).map((n) => (
                  <div className="history-row" key={n.id}>
                    <div>
                      <strong>
                        {n.notification_type.startsWith("test")
                          ? "Push test"
                          : "Daily reminder"}
                      </strong>
                      <small>{dateLabel(n.notification_date)}</small>
                    </div>
                    <span className="pill">{n.status}</span>
                  </div>
                ))
              ) : (
                <Empty>No push activity yet.</Empty>
              )}
              <p className="muted small">
                Accepted means the push provider accepted the message. Device
                display is verified only when you actually receive it.
              </p>
            </div>
          )}
        </Modal>
      )}
    </main>
  );
}

function Reports({
  data,
  currency,
  month,
  setMonth,
}: {
  data: Data;
  currency: Currency;
  month: string;
  setMonth: (m: string) => void;
}) {
  const rows = data.transactions.filter(
      (t) => t.currency === currency && t.transaction_date.startsWith(month),
    ),
    spent = total(rows, "expense", currency),
    income = total(rows, "income", currency);
  const end =
    month === today().slice(0, 7)
      ? today()
      : new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0, 12)
          .toISOString()
          .slice(0, 10);
  const days = Array.from({ length: 7 }, (_, i) => shiftDate(end, i - 6));
  const weekly = days.map((day) => ({
    label: new Date(day + "T12:00:00Z")
      .toLocaleDateString("en-GB", { weekday: "short" })
      .slice(0, 1),
    amount: total(
      data.transactions.filter((t) => t.transaction_date === day),
      "expense",
      currency,
    ),
  }));
  const monthly = [1, 2, 3, 4, 5].map((week, index) => ({
    label: "W" + week,
    amount: total(
      rows.filter((t) => {
        const d = Number(t.transaction_date.slice(8));
        return d >= index * 7 + 1 && d <= (index + 1) * 7;
      }),
      "expense",
      currency,
    ),
  }));
  const categories = data.categories
    .filter((c) => c.transaction_type === "expense")
    .map((c) => ({
      category: c,
      amount: total(
        rows.filter((t) => t.category_id === c.id),
        "expense",
        currency,
      ),
    }))
    .filter((c) => c.amount > 0n)
    .sort((a, b) => (a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0));
  return (
    <>
      <label className="month-selector">
        Month
        <input
          type="month"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
        />
      </label>
      <div className="two-columns report-stats">
        <div className="card">
          <small>INCOME</small>
          <strong className="positive">{money(income, currency)}</strong>
        </div>
        <div className="card">
          <small>EXPENSES</small>
          <strong>{money(spent, currency)}</strong>
        </div>
      </div>
      <div className="card chart-card">
        <div className="section-heading">
          <h2>Weekly spending</h2>
          <small>7 days to {dateLabel(end)}</small>
        </div>
        <BarChart values={weekly} currency={currency} />
      </div>
      <div className="card chart-card">
        <h2>Monthly spending</h2>
        <BarChart values={monthly} currency={currency} />
      </div>
      <div className="card chart-card">
        <h2>Where your money goes</h2>
        {categories.length ? (
          categories.map(({ category, amount }) => (
            <div className="category-report" key={category.id}>
              <div className="row">
                <span>
                  <Icon category={category} />
                  {category.name}
                </span>
                <strong>{money(amount, currency)}</strong>
              </div>
              <div className="progress">
                <span
                  style={{
                    width: percentage(amount, spent) + "%",
                    background: category.color,
                  }}
                />
              </div>
            </div>
          ))
        ) : (
          <Empty>No spending recorded this month.</Empty>
        )}
      </div>
      <div className="card chart-card">
        <h2>Income vs expenses</h2>
        <BarChart
          values={[
            { label: "Income", amount: income },
            { label: "Expenses", amount: spent },
          ]}
          currency={currency}
        />
      </div>
    </>
  );
}
function BarChart({
  values,
  currency,
}: {
  values: { label: string; amount: bigint }[];
  currency: Currency;
}) {
  const max = values.reduce((m, v) => (v.amount > m ? v.amount : m), 0n);
  return (
    <div
      className="chart"
      role="img"
      aria-label={values
        .map((v) => `${v.label}: ${money(v.amount, currency)}`)
        .join(", ")}
    >
      {values.map((v, i) => (
        <div className="chart-column" key={i}>
          <div className="bar-track">
            <span
              style={{
                height:
                  (max ? Math.max(2, percentage(v.amount, max)) : 0) + "%",
              }}
            />
          </div>
          <small>{v.label}</small>
          <span className="chart-amount">{decimal(v.amount)}</span>
        </div>
      ))}
    </div>
  );
}
type Save = (
  body: unknown,
  method?: string,
  message?: string,
) => Promise<boolean>;
function CheckinForm({
  data,
  date,
  setDate,
  busy,
  save,
  addExpense,
}: {
  data: Data;
  date: string;
  setDate: (v: string) => void;
  busy: boolean;
  save: Save;
  addExpense: () => void;
}) {
  const existing = data.checkins.find((c) => c.checkin_date === date);
  const [allRecorded, setAllRecorded] = useState(false),
    [impulse, setImpulse] = useState(false),
    [unrecorded, setUnrecorded] = useState(false),
    [zero, setZero] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    setAllRecorded(Boolean(existing));
    setImpulse(existing?.has_impulse_purchase ?? false);
    setUnrecorded(false);
    setZero(false);
    setConfirmed(false);
  }, [date, existing]);
  const expenses = data.transactions.filter(
      (t) => t.transaction_date === date && t.transaction_type === "expense",
    ),
    streak = streaks(data.checkins);
  return (
    <div className="form-stack">
      <div className="checkin-intro">
        <span className="large-icon">
          <Flame size={29} />
        </span>
        <h3>Close the day with clarity.</h3>
        <p className="muted">No judgment. Just a moment of awareness.</p>
      </div>
      <div className="two-columns">
        <div className="mini-stat">
          <strong>{streak.current}</strong>
          <small>Current streak</small>
        </div>
        <div className="mini-stat">
          <strong>{streak.longest}</strong>
          <small>Longest streak</small>
        </div>
      </div>
      <label>
        Review date
        <input
          type="date"
          value={date}
          max={today()}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
      </label>
      {existing && (
        <p className="success-note">
          <CircleCheck size={17} /> This day is completed. You can review it
          again.
        </p>
      )}
      <form
        className="form-stack"
        key={date}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void save(
            {
              entity: "checkin",
              checkin_date: date,
              status: "completed",
              has_unrecorded_spending: unrecorded,
              has_impulse_purchase: impulse,
              notes: String(f.get("notes")),
              confirmed,
              zero_spending_confirmed: zero,
            },
            "POST",
            "Daily check-in completed.",
          );
        }}
      >
        <label className="check-row">
          <input
            type="checkbox"
            checked={allRecorded}
            onChange={(e) => setAllRecorded(e.target.checked)}
          />
          <span>I have recorded all spending for this day.</span>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={impulse}
            onChange={(e) => setImpulse(e.target.checked)}
          />
          <span>I bought something impulsively.</span>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={unrecorded}
            onChange={(e) => setUnrecorded(e.target.checked)}
          />
          <span>There is spending I still need to record.</span>
        </label>
        {unrecorded && (
          <button type="button" className="secondary" onClick={addExpense}>
            <Plus size={18} /> Record an expense first
          </button>
        )}
        {!expenses.length && (
          <label className="check-row zero">
            <input
              type="checkbox"
              checked={zero}
              onChange={(e) => setZero(e.target.checked)}
            />
            <span>I explicitly confirm this was a zero-spending day.</span>
          </label>
        )}
        <label>
          Notes <span className="muted">(optional)</span>
          <textarea
            name="notes"
            maxLength={1000}
            defaultValue={existing?.notes}
            placeholder="Anything you’d like to remember?"
            rows={3}
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>I confirm this review is complete.</span>
        </label>
        <button
          className="primary"
          disabled={
            busy ||
            !allRecorded ||
            unrecorded ||
            !confirmed ||
            (!expenses.length && !zero)
          }
        >
          {busy ? "Saving…" : "Complete check-in"}
          <Check size={18} />
        </button>
      </form>
      <h3>Your check-in history</h3>
      {data.checkins.length ? (
        data.checkins.slice(0, 60).map((c) => (
          <button
            className="history-row"
            key={c.id}
            onClick={() => setDate(c.checkin_date)}
          >
            <div>
              <strong>{dateLabel(c.checkin_date)}</strong>
              <small>
                {c.has_impulse_purchase
                  ? "Impulse purchase noted"
                  : "Reviewed with intention"}
              </small>
            </div>
            <span className="positive">
              <CircleCheck size={18} />
            </span>
          </button>
        ))
      ) : (
        <Empty>Your first review starts a new habit.</Empty>
      )}
      <p className="muted small">
        Close this screen to recover if your network is unavailable. Reviews are
        saved only after a successful database response.
      </p>
    </div>
  );
}
function BudgetSettings({
  data,
  currency,
  editing,
  setEditing,
  busy,
  save,
}: {
  data: Data;
  currency: Currency;
  editing: Budget | null;
  setEditing: (v: Budget | null) => void;
  busy: boolean;
  save: Save;
}) {
  const [month, setMonth] = useState(today().slice(0, 7));
  return (
    <div className="form-stack">
      <label>
        Budget month
        <input
          type="month"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
        />
      </label>
      {data.budgets
        .filter((b) => b.month.startsWith(month))
        .map((b) => (
          <BudgetCard
            key={b.id}
            budget={b}
            data={data}
            onEdit={() => setEditing(b)}
          />
        ))}
      <h3>{editing ? "Edit budget" : "Create a budget"}</h3>
      <form
        className="form-stack"
        key={editing?.id ?? "new"}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void save({
            entity: "budget",
            id: editing?.id,
            month: String(f.get("month")) + "-01",
            currency: String(f.get("currency")),
            category_id: String(f.get("category")) || null,
            limit_amount: String(f.get("amount")),
          });
        }}
      >
        <div className="two-columns">
          <label>
            Month
            <input
              name="month"
              type="month"
              defaultValue={editing?.month.slice(0, 7) ?? month}
              required
            />
          </label>
          <label>
            Currency
            <select
              name="currency"
              defaultValue={editing?.currency ?? currency}
            >
              <option>MYR</option>
              <option>SGD</option>
            </select>
          </label>
        </div>
        <label>
          Scope
          <select name="category" defaultValue={editing?.category_id ?? ""}>
            <option value="">Overall monthly budget</option>
            {data.categories
              .filter((c) => c.transaction_type === "expense")
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Monthly limit
          <input
            name="amount"
            inputMode="decimal"
            defaultValue={editing?.limit_amount}
            placeholder="0.00"
            required
          />
        </label>
        <button className="primary" disabled={busy}>
          {busy ? "Saving…" : "Save budget"}
        </button>
        {editing && (
          <>
            <button
              className="secondary"
              type="button"
              onClick={() => setEditing(null)}
            >
              Create another budget
            </button>
            <button
              className="danger-button"
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Delete this budget?"))
                  void save(
                    { entity: "budget", id: editing.id },
                    "DELETE",
                    "Budget deleted.",
                  );
              }}
            >
              Delete budget
            </button>
          </>
        )}
      </form>
      <p className="muted small">
        Alerts appear at 50%, 80% and 100%. Overall and category budgets
        overlap; they are never added together.
      </p>
    </div>
  );
}
function CategorySettings({
  data,
  busy,
  save,
}: {
  data: Data;
  busy: boolean;
  save: Save;
}) {
  const [editing, setEditing] = useState<Category | null>(null);
  return (
    <div className="form-stack">
      {data.categories.map((c) => (
        <div className="category-setting" key={c.id}>
          <Icon category={c} />
          <span>
            <strong>{c.name}</strong>
            <small>{c.transaction_type}</small>
          </span>
          <button
            className="icon-button"
            aria-label={"Edit " + c.name}
            onClick={() => setEditing(c)}
          >
            <Pencil size={17} />
          </button>
          <button
            className="icon-button"
            aria-label={"Delete " + c.name}
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  "Delete this category? Categories used by records cannot be deleted.",
                )
              )
                void save(
                  { entity: "category", id: c.id },
                  "DELETE",
                  "Category deleted.",
                );
            }}
          >
            <Trash2 size={17} />
          </button>
        </div>
      ))}
      <h3>{editing ? "Edit category" : "New category"}</h3>
      <form
        className="form-stack"
        key={editing?.id ?? "new"}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void save({
            entity: "category",
            id: editing?.id,
            name: String(f.get("name")),
            transaction_type: String(f.get("type")),
            icon: String(f.get("icon")),
            color: String(f.get("color")),
          });
        }}
      >
        <label>
          Name
          <input
            name="name"
            maxLength={50}
            defaultValue={editing?.name}
            required
          />
        </label>
        <div className="two-columns">
          <label>
            Type
            <select
              name="type"
              defaultValue={editing?.transaction_type ?? "expense"}
            >
              <option>expense</option>
              <option>income</option>
            </select>
          </label>
          <label>
            Icon
            <select name="icon" defaultValue={editing?.icon ?? "other"}>
              {Object.keys(icons).map((key) => (
                <option key={key}>{key}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Color
          <input
            name="color"
            type="color"
            defaultValue={editing?.color ?? "#27624b"}
          />
        </label>
        <button className="primary" disabled={busy}>
          Save category
        </button>
        {editing && (
          <button
            className="secondary"
            type="button"
            onClick={() => setEditing(null)}
          >
            Add a new category
          </button>
        )}
      </form>
    </div>
  );
}
function NotificationSettings({
  data,
  busy,
  save,
  refresh,
  feedback,
  error,
}: {
  data: Data;
  busy: boolean;
  save: Save;
  refresh: () => Promise<void>;
  feedback: (s: string) => void;
  error: (s: string) => void;
}) {
  const [pushBusy, setPushBusy] = useState(false),
    [permission, setPermission] = useState("Checking…");
  useEffect(() => {
    setPermission(
      "Notification" in window
        ? Notification.permission
        : "Unsupported in this browser",
    );
  }, []);
  async function enable() {
    if (pushBusy) return;
    setPushBusy(true);
    error("");
    try {
      if (
        !("Notification" in window) ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window)
      )
        throw new Error(
          "Install on the iPhone Home Screen, then enable notifications from the installed app.",
        );
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key)
        throw new Error("Configure the VAPID public key and redeploy first.");
      // Permission is requested immediately within the button gesture.
      const allowed = await Notification.requestPermission();
      setPermission(allowed);
      if (allowed !== "granted")
        throw new Error(
          "Permission was not granted. Check iPhone notification settings.",
        );
      await navigator.serviceWorker.register("/sw.js");
      const reg = await navigator.serviceWorker.ready;
      const padding = "=".repeat((4 - (key.length % 4)) % 4),
        raw = atob((key + padding).replace(/-/g, "+").replace(/_/g, "/"));
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: bytes,
        }));
      await api("/api/push", "POST", sub.toJSON());
      feedback("Push subscription saved. Send a test to verify delivery.");
      await refresh();
    } catch (e) {
      error((e as Error).message);
    } finally {
      setPushBusy(false);
    }
  }
  async function disable() {
    if (pushBusy) return;
    setPushBusy(true);
    error("");
    try {
      await api("/api/push", "DELETE");
      const reg = await navigator.serviceWorker?.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      await sub?.unsubscribe();
      feedback("Push disabled on all registered devices.");
      await refresh();
    } catch (e) {
      error((e as Error).message);
    } finally {
      setPushBusy(false);
    }
  }
  async function test() {
    if (pushBusy) return;
    setPushBusy(true);
    error("");
    try {
      const result = await api("/api/push/test", "POST", {});
      if (result.duplicate)
        feedback("A test was already requested this minute.");
      else if (!result.accepted)
        throw new Error(
          "Push provider rejected the test. Enable again or check VAPID settings.",
        );
      else
        feedback(
          `Provider accepted ${result.accepted} message(s). Check your actual notification.${result.failed ? " Some subscriptions failed." : ""}`,
        );
      await refresh();
    } catch (e) {
      error((e as Error).message);
    } finally {
      setPushBusy(false);
    }
  }
  return (
    <div className="form-stack">
      <div className="card push-status">
        <Bell size={23} />
        <div>
          <strong>Web Push</strong>
          <p>
            {data.preferences.push_enabled
              ? "Subscription enabled"
              : "Subscription not enabled"}{" "}
            · Permission: {permission}
          </p>
        </div>
      </div>
      <button
        className="primary"
        disabled={pushBusy}
        onClick={() => void enable()}
      >
        {pushBusy ? "Working…" : "Enable notifications on this device"}
      </button>
      <button
        className="secondary"
        disabled={pushBusy || !data.preferences.push_enabled}
        onClick={() => void test()}
      >
        Send a real test notification
      </button>
      {data.preferences.push_enabled && (
        <button
          className="text-button"
          disabled={pushBusy}
          onClick={() => void disable()}
        >
          Disable push on all devices
        </button>
      )}
      <h3>Daily reminder</h3>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void save({
            entity: "preferences",
            daily_reminder_enabled: f.get("enabled") === "on",
            reminder_time: String(f.get("time")),
            timezone: "Asia/Singapore",
          });
        }}
      >
        <label className="check-row">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={data.preferences.daily_reminder_enabled}
          />
          <span>Enable daily reminders</span>
        </label>
        <label>
          In-app reminder time
          <input
            type="time"
            name="time"
            defaultValue={data.preferences.reminder_time.slice(0, 5)}
            required
          />
        </label>
        <button className="primary" disabled={busy}>
          Save preferences
        </button>
      </form>
      <p className="muted small">
        Asia/Singapore · Free-tier push runs approximately 21:00–21:59,
        independently of your chosen in-app time. Changing push time requires
        changing the daily schedule in vercel.json. iPhone push requires a Home
        Screen app and your permission. Delivery can be delayed or blocked by
        connectivity, Focus or service availability.
      </p>
    </div>
  );
}
function ExportForm({
  data,
  feedback,
  error,
}: {
  data: Data;
  feedback: (s: string) => void;
  error: (s: string) => void;
}) {
  const [exporting, setExporting] = useState(false);
  async function download(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (exporting) return;
    setExporting(true);
    error("");
    const f = new FormData(event.currentTarget),
      from = String(f.get("from")),
      to = String(f.get("to")),
      type = String(f.get("type")),
      currency = String(f.get("currency"));
    try {
      if (from && to && from > to)
        throw new Error("The start date must be before the end date.");
      const rows = data.transactions.filter(
        (t) =>
          (!type || t.transaction_type === type) &&
          (!from || t.transaction_date >= from) &&
          (!to || t.transaction_date <= to) &&
          (!currency || t.currency === currency),
      );
      const name = "my-money-" + today() + ".csv";
      const file = new File([transactionCsv(rows, data.categories)], name, {
        type: "text/csv;charset=utf-8",
      });
      if (f.get("share") && navigator.canShare?.({ files: [file] }))
        await navigator.share({ files: [file], title: "My Money export" });
      else {
        const url = URL.createObjectURL(file);
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      feedback(`Export created with ${rows.length} transaction(s).`);
    } catch (e) {
      if ((e as Error).name !== "AbortError") error((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  return (
    <form className="form-stack" onSubmit={download}>
      <div className="large-icon">
        <Download size={29} />
      </div>
      <p>
        Keep a copy of your records. Every amount retains its original currency.
      </p>
      <label>
        Transactions
        <select name="type">
          <option value="">All transactions</option>
          <option value="income">Income only</option>
          <option value="expense">Expenses only</option>
        </select>
      </label>
      <label>
        Currency
        <select name="currency">
          <option value="">Both currencies · separate rows</option>
          <option>MYR</option>
          <option>SGD</option>
        </select>
      </label>
      <div className="two-columns">
        <label>
          From
          <input name="from" type="date" />
        </label>
        <label>
          To
          <input name="to" type="date" />
        </label>
      </div>
      <label className="check-row">
        <input type="checkbox" name="share" defaultChecked />
        <span>Use iOS Share when available</span>
      </label>
      <button className="primary" disabled={exporting}>
        {exporting ? "Creating export…" : "Export CSV"}
        <Download size={18} />
      </button>
      <p className="muted small">
        UTF-8 CSV with spreadsheet-compatible BOM and formula injection
        protection. Export uses the latest successfully loaded records; refresh
        the app first after changes on another device.
      </p>
    </form>
  );
}
