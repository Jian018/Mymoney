import { test } from "node:test";
import assert from "node:assert/strict";
import {
  budgetSpent,
  cents,
  csvCell,
  decimal,
  money,
  percentage,
  shiftDate,
  streaks,
  thresholdCrossed,
  today,
  total,
  transactionCsv,
} from "../src/lib/finance";
import { recordSchema, validPushEndpoint } from "../src/lib/validation";
import type { Transaction, Checkin } from "../src/lib/finance";
const category = "11111111-1111-4111-8111-111111111111";
const rows: Transaction[] = [
  {
    id: "a",
    transaction_type: "expense",
    category_id: category,
    amount: "0.10",
    currency: "MYR",
    description: "=SUM(A1)",
    transaction_date: "2026-10-08",
  },
  {
    id: "b",
    transaction_type: "expense",
    category_id: category,
    amount: "0.20",
    currency: "MYR",
    description: 'Coffee, "milk"\nwith bread',
    transaction_date: "2026-10-08",
  },
  {
    id: "c",
    transaction_type: "expense",
    category_id: category,
    amount: "15.50",
    currency: "SGD",
    description: "",
    transaction_date: "2026-10-08",
  },
  {
    id: "d",
    transaction_type: "income",
    category_id: category,
    amount: "100.00",
    currency: "MYR",
    description: "",
    transaction_date: "2026-09-30",
  },
];
test("money stays decimal-safe including maximum values", () => {
  assert.equal(cents("0.10") + cents("0.20"), 30n);
  assert.equal(decimal(-30n), "-0.30");
  assert.equal(cents("999999999999.99"), 99999999999999n);
  assert.equal(money(123456n, "MYR"), "RM 1,234.56");
  assert.throws(() => cents("1.001"));
  assert.throws(() => cents("1e3"));
});
test("currencies and month boundaries never combine", () => {
  assert.equal(total(rows, "expense", "MYR"), 30n);
  assert.equal(total(rows, "expense", "SGD"), 1550n);
  assert.equal(
    budgetSpent(
      {
        id: "b",
        month: "2026-10-01",
        category_id: null,
        currency: "MYR",
        limit_amount: "1.00",
      },
      rows,
    ),
    30n,
  );
});
test("all budget threshold crossings and editing below threshold", () => {
  assert.equal(thresholdCrossed(49n, 50n, 100n), 50);
  assert.equal(thresholdCrossed(70n, 85n, 100n), 80);
  assert.equal(thresholdCrossed(40n, 110n, 100n), 100);
  assert.equal(thresholdCrossed(85n, 90n, 100n), null);
  assert.equal(thresholdCrossed(110n, 80n, 100n), null);
  assert.equal(percentage(1n, 3n), 33.33);
});
test("Singapore calendar dates are stable across UTC midnight", () => {
  assert.equal(today(new Date("2026-10-07T16:00:00Z")), "2026-10-08");
  assert.equal(today(new Date("2026-10-07T15:59:59Z")), "2026-10-07");
  assert.equal(shiftDate("2024-03-01", -1), "2024-02-29");
});
test("current and longest streaks account for pending today", () => {
  const checks = ["2026-10-03", "2026-10-04", "2026-10-06", "2026-10-07"].map(
    (checkin_date) => ({ checkin_date, status: "completed" }),
  ) as Checkin[];
  assert.deepEqual(streaks(checks, "2026-10-08"), { current: 2, longest: 2 });
  assert.deepEqual(streaks(checks, "2026-10-10"), { current: 0, longest: 2 });
});
test("CSV has BOM, escaped quotes and formula injection protection", () => {
  const csv = transactionCsv(rows, []);
  assert.equal(csv[0], "\uFEFF");
  assert.ok(csv.includes('"\'=SUM(A1)"'));
  assert.ok(csv.includes('"Coffee, ""milk""\nwith bread"'));
  assert.equal(csvCell("   +42"), '"\'   +42"');
  assert.equal(csvCell("@x"), '"\'@x"');
  assert.equal(csvCell("\tformula"), '"\'\tformula"');
});
test("invalid money and nonexistent calendar dates are rejected", () => {
  const base = {
    entity: "transaction",
    transaction_type: "expense",
    category_id: category,
    amount: "1.00",
    currency: "MYR",
    description: "",
    transaction_date: "2024-02-29",
  };
  assert.equal(recordSchema.safeParse(base).success, true);
  for (const amount of ["0", "-1", "1.001", "NaN"])
    assert.equal(recordSchema.safeParse({ ...base, amount }).success, false);
  assert.equal(
    recordSchema.safeParse({ ...base, transaction_date: "2025-02-29" }).success,
    false,
  );
  assert.equal(
    recordSchema.safeParse({ ...base, currency: "USD" }).success,
    false,
  );
});
test("push endpoints cannot target local networks or arbitrary services", () => {
  assert.equal(validPushEndpoint("https://web.push.apple.com/abc"), true);
  assert.equal(
    validPushEndpoint("https://fcm.googleapis.com/fcm/send/a"),
    true,
  );
  for (const url of [
    "http://web.push.apple.com/a",
    "https://127.0.0.1/a",
    "https://web.push.apple.com.evil.test/a",
    "https://evil.test/a",
    "https://user:pass@web.push.apple.com/a",
    "https://web.push.apple.com:8443/a",
  ])
    assert.equal(validPushEndpoint(url), false);
});
