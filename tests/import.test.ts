import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  normalizeCsv,
  currencyAmount,
  parseCsv,
  requestedHistory,
} from "../src/lib/import/normalize";
import { total, transactionCsv } from "../src/lib/finance";
import { paypalAdapter } from "../src/lib/import/paypal";
test("official PayPal adapter paginates seven-day history and keeps payments for review", async () => {
  const keys = [
    "PAYPAL_BUSINESS_API_ENABLED",
    "PAYPAL_CLIENT_ID",
    "PAYPAL_CLIENT_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY",
  ] as const;
  const previous = keys.map((k) => process.env[k]);
  const oldFetch = globalThis.fetch;
  const calls: string[] = [];
  try {
    keys.forEach(
      (k) =>
        (process.env[k] =
          k === "PAYPAL_BUSINESS_API_ENABLED" ? "true" : "fixture-only"),
    );
    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/token"))
        return Response.json({
          access_token: "fixture",
          scope: "https://uri.paypal.com/services/reporting/search/read",
        });
      const page = new URL(url).searchParams.get("page");
      return Response.json({
        total_pages: 2,
        transaction_details: [
          {
            transaction_info: {
              transaction_id: "fixture-" + page,
              transaction_event_code: "T0006",
              transaction_initiation_date: "2026-10-12T23:59:00+08:00",
              transaction_amount: {
                value: "-12.30",
                currency_code: page === "1" ? "MYR" : "SGD",
              },
              transaction_subject: "Shop",
            },
          },
        ],
      });
    };
    const result = await paypalAdapter.synchronize();
    assert.equal(result.rows.length, 2);
    assert.deepEqual(
      result.rows.map((r) => r.currency),
      ["MYR", "SGD"],
    );
    assert.ok(
      result.rows.every(
        (r) => r.flow === "unknown" && r.reason.includes("classify"),
      ),
    );
    assert.equal(result.rows[0].amount, "12.30");
    assert.equal(result.rows[0].original_amount, "-12.30");
    const query = new URL(calls[1]).searchParams;
    assert.match(query.get("start_date")!, /T00:00:00\+08:00$/);
    assert.equal(query.get("balance_affecting_records_only"), "Y");
    assert.equal(calls.length, 3);
    globalThis.fetch = async (input) =>
      String(input).endsWith("/token")
        ? Response.json({
            access_token: "fixture",
            scope: "https://uri.paypal.com/services/reporting/search/read",
          })
        : new Response("denied", { status: 403 });
    await assert.rejects(paypalAdapter.synchronize(), /No partial import/);
    globalThis.fetch = async () =>
      Response.json({ access_token: "fixture", scope: "openid" });
    await assert.rejects(paypalAdapter.synchronize(), /not granted/);
  } finally {
    globalThis.fetch = oldFetch;
    keys.forEach((k, i) => {
      if (previous[i] === undefined) delete process.env[k];
      else process.env[k] = previous[i];
    });
  }
});
test("CSV preserves quoting, exact amounts, explicit currency and ambiguous fields", () => {
  assert.deepEqual(parseCsv('a,b\r\n"shop, one","a""b"\r\n'), [
    ["a", "b"],
    ["shop, one", 'a"b'],
  ]);
  assert.equal(currencyAmount("RM 12.30").currency, "MYR");
  assert.equal(currencyAmount("S$ 1.05").currency, "SGD");
  assert.equal(currencyAmount("$ 12").currency, null);
  assert.equal(currencyAmount("RM 12", "SGD").currency, null);
  assert.equal(currencyAmount("1,000", "MYR").amount, null);
  assert.equal(currencyAmount("1.001", "MYR").amount, null);
  const rows = normalizeCsv(
    "date,amount,currency,merchant,type,transaction_id\n2026-02-30,12.30,MYR,Store,expense,A\n2026-10-12,S$ 1.05,,Shop,refund,",
  );
  assert.equal(rows[0].transaction_date, null);
  assert.equal(rows[1].amount, "1.05");
  assert.equal(rows[1].flow, "refund");
  assert.throws(
    () =>
      normalizeCsv(
        "date,amount,currency,merchant,type,password\n2026-10-01,1,MYR,X,expense,secret",
      ),
    /Credential/,
  );
  assert.deepEqual(requestedHistory(new Date("2026-10-12T16:30:00Z")), {
    from: "2026-10-06",
    to: "2026-10-12",
  });
});
test("PostgreSQL imports are atomic, private, idempotent and do not double count", async () => {
  const db = new PGlite(),
    owner = "11111111-1111-4111-8111-111111111111",
    stranger = "22222222-2222-4222-8222-222222222222";
  try {
    await db.exec(
      `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema public,auth to anon,authenticated; grant execute on function auth.uid() to authenticated; insert into auth.users values('${owner}'),('${stranger}');`,
    );
    for (const file of [
      "001_initial.sql",
      "002_device_access.sql",
      "003_auto_import.sql",
    ])
      await db.exec(
        (
          await readFile(
            new URL("../supabase/migrations/" + file, import.meta.url),
            "utf8",
          )
        ).replace("create extension if not exists pgcrypto;", ""),
      );
    await db.exec(
      `insert into public.app_owner values(true,'${owner}'); insert into public.authorized_devices(device_user_id,owner_user_id,label) values('${owner}','${owner}','Phone'); set role authenticated; set request.jwt.claim.sub='${owner}';`,
    );
    const category = (
      await db.query<{ id: string }>(
        "select id from categories where name='Other' and transaction_type='expense'",
      )
    ).rows[0].id;
    const csv =
      "date,amount,currency,merchant,type,transaction_id\n2026-10-10,12.30,MYR,Cafe,expense,A\n2026-10-10,12.30,MYR,Cafe wallet,expense,B\n2026-10-11,50,MYR,Wallet,topup,C\n2026-10-11,5,MYR,Cafe,refund,D\n2026-10-11,2,,Shop,expense,E";
    const run = async (
      request: string,
      source: string,
      rows = normalizeCsv(csv),
    ) =>
      (
        await db.query<{
          result: {
            new: number;
            duplicate: number;
            pending: number;
            excluded: number;
          };
        }>("select public.run_import($1,$2,$3,$4,$5::jsonb) as result", [
          request,
          source,
          "account",
          "Unverified coverage",
          JSON.stringify(rows),
        ])
      ).rows[0].result;
    const first = await run("33333333-3333-4333-8333-333333333333", "csv");
    assert.equal(first.new, 1);
    assert.equal(first.pending, 3);
    assert.equal(first.excluded, 1);
    assert.deepEqual(
      await run("33333333-3333-4333-8333-333333333333", "csv"),
      first,
    );
    assert.equal(
      (await run("44444444-4444-4444-8444-444444444444", "csv")).duplicate,
      5,
    );
    const original = (
      await db.query<{ id: string }>(
        "select id from transactions where semantic_type='expense'",
      )
    ).rows[0].id;
    const cross = await run(
      "abababab-abab-4bab-8bab-abababababab",
      "wise",
      normalizeCsv(
        "date,amount,currency,merchant,type,transaction_id\n2026-10-10,13.00,MYR,Cafe,expense,DIFF",
      ),
    );
    assert.equal(cross.pending, 1);
    await assert.rejects(
      db.query(
        "select create_cash($1,'expense',$2,12.30,'MYR','2026-10-10','Cafe',false)",
        ["77777777-7777-4777-8777-777777777777", category],
      ),
      /similar imported/,
    );
    const cash = (
      await db.query<{ id: string }>(
        "select create_cash($1,'expense',$2,8.00,'MYR','2026-10-09','Manual breakfast',false) as id",
        ["88888888-8888-4888-8888-888888888888", category],
      )
    ).rows[0].id;
    const manualMatch = await run(
      "99999999-9999-4999-8999-999999999999",
      "maybank",
      normalizeCsv(
        "date,amount,currency,merchant,type,transaction_id\n2026-10-10,8.00,MYR,Bank description,expense,M",
      ),
    );
    assert.equal(manualMatch.pending, 1);
    assert.equal(manualMatch.new, 0);
    await db.query("delete from transactions where id=$1", [cash]);
    const bankMatch = await run(
      "55555555-5555-4555-8555-555555555555",
      "dbs",
      normalizeCsv(
        "date,amount,currency,merchant,type,transaction_id\n2026-10-12,12.30,MYR,Unrelated description,expense,BANK",
      ),
    );
    assert.equal(bankMatch.pending, 1);
    assert.equal(bankMatch.new, 0);
    const pending = (
      await db.query<{ id: string; flow: string; source: string }>(
        "select id,flow,source from import_items where status='pending'",
      )
    ).rows;
    await db.query("select review_import($1,'duplicate',$2)", [
      pending.find((i) => i.source === "dbs")!.id,
      original,
    ]);
    const refund = pending.find((i) => i.flow === "refund")!.id;
    await assert.rejects(
      db.query("select review_import($1,'refund',$2,null,null,null,13)", [
        refund,
        original,
      ]),
      /exceeds/,
    );
    await db.query("select review_import($1,'refund',$2)", [refund, original]);
    await run(
      "acacacac-acac-4cac-8cac-acacacacacac",
      "tng",
      normalizeCsv(
        "date,amount,currency,merchant,type,transaction_id\n2026-10-11,5,MYR,Cafe,refund,REFUND-AGAIN",
      ),
    );
    const repeatRefund = (
      await db.query<{ id: string }>(
        "select id from import_items where source='tng'",
      )
    ).rows[0].id;
    await assert.rejects(
      db.query("select review_import($1,'refund',$2)", [
        repeatRefund,
        original,
      ]),
      /similar refund/,
    );
    const refundTx = (
      await db.query<{ id: string }>(
        "select id from transactions where semantic_type='refund'",
      )
    ).rows[0].id;
    await db.query("select review_import($1,'duplicate',$2)", [
      repeatRefund,
      refundTx,
    ]);
    const money = (
      await db.query<any>(
        "select *,transaction_date::text as transaction_date,imported_at::text as imported_at from transactions_read",
      )
    ).rows;
    assert.equal(total(money, "expense", "MYR"), 730n);
    assert.match(transactionCsv(money, []), /Refund of/);
    await assert.rejects(
      db.query("update transactions set amount=1 where id=$1", [original]),
      /Auto Import/,
    );
    await assert.rejects(
      db.query("insert into import_items(user_id) values($1)", [owner]),
      /permission denied/,
    );
    await db.exec(`set request.jwt.claim.sub='${stranger}';`);
    assert.equal((await db.query("select * from import_items")).rows.length, 0);
    await assert.rejects(
      run("66666666-6666-4666-8666-666666666666", "csv"),
      /Unauthorized/,
    );
  } finally {
    await db.close();
  }
});
