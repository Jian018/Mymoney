import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { encrypt, decrypt, digest, equalSecret } from "../src/lib/gmail/crypto";
import {
  parseMessage,
  emailText,
  searchQuery,
  normalizeMerchant,
} from "../src/lib/gmail/parser";
import { total, transactionCsv, type Transaction } from "../src/lib/finance";
import type { GmailMessage } from "../src/lib/gmail/types";
// Synthetic unit fixtures verify code, NOT a live authorized Gmail integration.
function receipt(
  body = "Payment successful\nTransaction date: 2026-10-10\nMerchant: Shopee\nAmount paid: RM 89.90\nOrder ID: ORDER12345",
  domain = "shopee.com.my",
  html = false,
): GmailMessage {
  return {
    id: randomUUID(),
    internalDate: String(Date.parse("2026-10-11T10:00:00Z")),
    payload: {
      mimeType: html ? "text/html" : "text/plain",
      headers: [
        { name: "From", value: `Receipt <receipt@${domain}>` },
        { name: "Subject", value: "Payment receipt" },
        {
          name: "Authentication-Results",
          value: `mx.google.com; dmarc=pass header.from=${domain}`,
        },
      ],
      body: { data: Buffer.from(body).toString("base64url") },
    },
  };
}
test("deterministic plain/HTML extraction is decimal safe and conservative", () => {
  const parsed = parseMessage(receipt());
  assert.equal(parsed.auto_save, true);
  assert.equal(parsed.amount, "89.90");
  assert.equal(parsed.currency, "MYR");
  assert.equal(parsed.category, "Shopping");
  assert.equal(parsed.reference, "ORDER12345");
  assert.equal(
    parseMessage(
      receipt(
        "Payment successful\nTransaction date: 2026-10-10\nMerchant: Shopee\nAmount paid: RM 89.90\nRefund policy: contact the seller",
      ),
    ).auto_save,
    true,
  );
  assert.equal(
    parseMessage(
      receipt(
        "<h1>Payment successful</h1><p>Transaction date: 2026-10-10</p><p>Merchant: Cafe</p><p>Amount paid: S$ 12.30</p>",
        "dbs.com.sg",
        true,
      ),
    ).currency,
    "SGD",
  );
  for (const amount of [
    "$ 89.90",
    "USD 89.90",
    "RM 12.345",
    "RM 1,23.00",
    "RM 89.90\nSGD 25.90",
    "RM 89.90\nRM 99.90",
    "-RM 89.90",
    "RM 1e3",
  ]) {
    const c = parseMessage(
      receipt(
        `Payment successful\nTransaction date: 2026-10-10\nMerchant: Shop\nAmount paid: ${amount}`,
      ),
    );
    assert.equal(c.auto_save, false, amount);
  }
  assert.equal(
    parseMessage(receipt(undefined, "shopee.com.my.evil.example")).auto_save,
    false,
  );
  const forged = receipt();
  forged.payload!.headers![2].value =
    "mx.google.com; dmarc=pass header.from=shopee.com.my.evil.example";
  assert.equal(parseMessage(forged).auto_save, false);
  assert.equal(
    parseMessage(
      receipt(
        "Order confirmation\nTransaction date: 2026-10-10\nAmount paid: RM 89.90",
      ),
    ).auto_save,
    false,
  );
  assert.equal(
    parseMessage(
      receipt(
        "Payment successful\nDate: 10/11/2026\nMerchant: Cafe\nAmount paid: RM 89.90",
      ),
    ).transaction_date,
    null,
  );
  assert.equal(normalizeMerchant("SHOPEE * purchase"), "shopee");
  assert.equal(
    parseMessage(
      receipt(
        "Payment successful\nCard purchase\nTransaction date: 2026-10-10\nMerchant: Cafe\nAmount paid: SGD 12.30",
        "dbs.com.sg",
      ),
    ).auto_save,
    true,
  );
  assert.equal(
    parseMessage(
      receipt(
        "Payment successful\nCard purchase\nFunds received\nTransaction date: 2026-10-10\nMerchant: Cafe\nAmount paid: SGD 12.30",
        "dbs.com.sg",
      ),
    ).auto_save,
    false,
  );
  assert.equal(
    emailText({
      mimeType: "text/plain",
      filename: "attachment.txt",
      body: { data: Buffer.from("secret attachment").toString("base64url") },
    }),
    "",
  );
  assert.ok(!JSON.stringify(parsed.evidence).includes("Payment successful"));
});
test("non-spending and incomplete email events are never auto expenses", () => {
  for (const [text, status] of [
    ["Wallet top-up successful", "topup"],
    ["Internal transfer completed", "transfer"],
    ["Authorization hold", "hold"],
    ["Order cancelled", "cancelled"],
    ["Payment pending", "pending"],
    ["Refund completed", "refund"],
  ]) {
    const c = parseMessage(
      receipt(
        `${text}\nTransaction date: 2026-10-10\nMerchant: Shopee\nAmount paid: RM 89.90`,
      ),
    );
    assert.equal(c.payment_status, status);
    assert.equal(c.auto_save, false);
  }
  const c = parseMessage(
    receipt(
      "支付成功\n交易日期：2026-10-10\n商户：Taobao\n支付金额：MYR 89.90\n订单号：1234567890",
      "taobao.com",
    ),
  );
  assert.equal(c.auto_save, true);
  assert.equal(c.category, "Shopping");
  const q = searchQuery(1_000_000, 605_800_000);
  assert.match(q, /after:1000 before:605801/);
  assert.match(q, /-in:sent/);
});
test("OAuth/token cryptography rejects tampering and another owner/context", () => {
  const prior = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  process.env.GMAIL_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  try {
    const ciphertext = encrypt({ refresh_token: "fixture-only" }, "owner:one");
    assert.ok(!ciphertext.includes("fixture-only"));
    assert.deepEqual(decrypt(ciphertext, "owner:one"), {
      refresh_token: "fixture-only",
    });
    assert.throws(() => decrypt(ciphertext, "owner:two"));
    assert.throws(() =>
      decrypt(ciphertext.slice(0, -5) + "aaaaa", "owner:one"),
    );
    assert.equal(equalSecret(digest("state"), digest("state")), true);
    assert.equal(equalSecret("state", "other-state"), false);
  } finally {
    if (prior === undefined) delete process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
    else process.env.GMAIL_TOKEN_ENCRYPTION_KEY = prior;
  }
});
const owner = "11111111-1111-4111-8111-111111111111",
  device = "22222222-2222-4222-8222-222222222222",
  stranger = "33333333-3333-4333-8333-333333333333";
test("PostgreSQL Gmail imports, review, RLS, exact uniqueness, refunds and disconnect", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to authenticated;insert into auth.users values('${owner}'),('${device}'),('${stranger}');`,
    );
    for (const name of [
      "001_initial.sql",
      "002_device_access.sql",
      "003_auto_import.sql",
    ]) {
      await db.exec(
        (
          await readFile(
            new URL("../supabase/migrations/" + name, import.meta.url),
            "utf8",
          )
        ).replace("create extension if not exists pgcrypto;", ""),
      );
    }
    await db.exec(
      `insert into app_owner values(true,'${owner}');insert into authorized_devices(device_user_id,owner_user_id,label) values('${device}','${owner}','Phone');`,
    );
    const cat = (
      await db.query<{ id: string }>(
        "select id from categories where name='Other' and transaction_type='expense'",
      )
    ).rows[0].id;

    const legacy = (
      await db.query<{ id: string }>(
        "insert into transactions(user_id,transaction_type,category_id,amount,currency,description,transaction_date,source,source_transaction_id,imported_at,merchant,semantic_type) values($1,'expense',$2,5,'MYR','Legacy', '2026-10-01','dbs','old-id',now(),'Legacy','expense') returning id",
        [owner, cat],
      )
    ).rows[0].id;
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/004_gmail_expense_sync.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    assert.equal(
      (await db.query("select * from transactions where id=$1", [legacy])).rows
        .length,
      1,
    );
    await db.query(
      "insert into gmail_connections(user_id,google_account_id,email,connection_status) values($1,'google-fixture','fixture@example.com','connected')",
      [owner],
    );
    const auth = () =>
        db.exec(
          `set role authenticated;set request.jwt.claim.sub='${device}';`,
        ),
      service = () => db.exec("set role service_role;");
    await auth();

    await assert.rejects(
      db.query("select * from gmail_private_tokens"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select gmail_start_sync($1,$2)", [randomUUID(), owner]),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select run_import($1,'dbs','csv','','[]'::jsonb)", [
        randomUUID(),
      ]),
      /permission denied/,
    );
    await service();
    const start = async (request = randomUUID()) =>
      (
        await db.query<{ r: { id: string; existing: boolean } }>(
          "select gmail_start_sync($1,$2) r",
          [request, owner],
        )
      ).rows[0].r;
    const request = randomUUID(),
      run = await start(request);
    assert.equal((await start(request)).existing, true);
    await assert.rejects(start(), /already running/);
    const commit = async (
      id: string,
      c: ReturnType<typeof parseMessage> | null,
      result = "candidate",
    ) =>
      (
        await db.query<{ r: string }>(
          "select gmail_commit_message($1,$2,$3,$4::jsonb,$5) r",
          [run.id, id, result, JSON.stringify(c), owner],
        )
      ).rows[0].r;
    const c = parseMessage(receipt());
    assert.equal(await commit("message-one", c), "imported");
    assert.equal(await commit("message-one", c), "duplicate");
    assert.equal(await commit("message-two", c), "duplicate");
    const tx = (
      await db.query<{ id: string }>(
        "select id from transactions where source='gmail'",
      )
    ).rows[0].id;
    await assert.rejects(
      db.query(
        "insert into transactions(user_id,request_id,transaction_type,category_id,amount,currency,description,transaction_date,source,source_transaction_id,imported_at,merchant,semantic_type) select user_id,gen_random_uuid(),transaction_type,category_id,amount,currency,description,transaction_date,source,source_transaction_id,imported_at,merchant,semantic_type from transactions where id=$1",
        [tx],
      ),
      /unique constraint/,
    );
    await auth();
    await assert.rejects(
      db.query(
        "select create_cash($1,'expense',$2,89.90,'MYR','2026-10-10','Shopee',false)",
        [randomUUID(), cat],
      ),
      /similar imported/i,
    );
    await service();
    const bank = parseMessage(receipt(undefined, "pbebank.com"));
    bank.reference_key = "public-bank:completed:other";
    assert.equal(await commit("bank-confirmation", bank), "review");
    const sgd = {
      ...c,
      currency: "SGD",
      merchant: "Different SGD shop",
      merchant_key: "differentsgdshop",
      reference: "SGD12345",
      reference_key: "shopee:completed:sgd",
    };
    assert.equal(await commit("sgd-receipt", sgd), "imported");
    const foreign = parseMessage(
      receipt(
        "Payment successful\nCard purchase\nTransaction date: 2026-10-10\nMerchant: Shopee\nAmount paid: SGD 25.90\nTransaction ID: FOREIGN12345",
        "dbs.com.sg",
      ),
    );
    assert.equal(foreign.auto_save, true);
    assert.equal(await commit("foreign-settlement", foreign), "review");
    const unknown = {
      ...c,
      currency: null,
      auto_save: false,
      reference_key: null,
      reason: "Ambiguous $",
    };
    assert.equal(await commit("unknown-currency", unknown), "review");
    const refund = {
      ...c,
      amount: "10.00",
      payment_status: "refund" as const,
      auto_save: false,
      reference_key: "shopee:refund:one",
      reason: "Refund requires linking",
    };
    assert.equal(await commit("refund-one", refund), "review");
    assert.equal(
      await commit("topup", {
        ...c,
        payment_status: "topup",
        reference_key: "topup",
        auto_save: false,
      }),
      "ignored",
    );
    assert.equal(await commit("failed", null, "failed"), "failed");
    assert.equal(
      await commit("failed", {
        ...c,
        amount: "14.00",
        merchant: "Different",
        merchant_key: "different",
        transaction_date: "2026-10-02",
        reference_key: "retry",
      }),
      "imported",
    );
    await db.query(
      "select gmail_finish_sync($1,'completed','fixture run',$2)",
      [run.id, owner],
    );
    const candidates = (
      await db.query<{ id: string; gmail_message_id: string }>(
        "select id,gmail_message_id from gmail_import_candidates",
      )
    ).rows;
    const candidate = (id: string) =>
      candidates.find((x) => x.gmail_message_id === id)!.id;
    await auth();
    await assert.rejects(
      db.query("select gmail_review($1,'approve',$2)", [
        candidate("bank-confirmation"),
        cat,
      ]),
      /Possible duplicate/,
    );
    await db.query("select gmail_review($1,'duplicate',$2,$3)", [
      candidate("bank-confirmation"),
      cat,
      tx,
    ]);
    await assert.rejects(
      db.query("select gmail_review($1,'approve',$2)", [
        candidate("foreign-settlement"),
        cat,
      ]),
      /Possible duplicate/,
    );
    await assert.rejects(
      db.query("select gmail_review($1,'duplicate',$2,$3)", [
        candidate("foreign-settlement"),
        cat,
        tx,
      ]),
      /match amount and currency/,
    );
    await db.query(
      "select gmail_review($1,'duplicate',$2,$3,25.90,'SGD','2026-10-10','Shopee',false,true)",
      [candidate("foreign-settlement"), cat, tx],
    );
    await assert.rejects(
      db.query("select gmail_review($1,'approve',$2)", [
        candidate("unknown-currency"),
        cat,
      ]),
      /Valid amount/,
    );
    await db.query("select gmail_review($1,'refund',$2,$3)", [
      candidate("refund-one"),
      cat,
      tx,
    ]);
    const rows = (
      await db.query<Transaction>(
        "select *,transaction_date::text as transaction_date,imported_at::text as imported_at from transactions_read",
      )
    ).rows;
    assert.equal(
      total(
        rows.filter((t) => t.transaction_date === "2026-10-10"),
        "expense",
        "MYR",
      ),
      7990n,
    );
    assert.equal(total(rows, "expense", "SGD"), 8990n);
    assert.match(transactionCsv(rows, []), /Gmail message ID/);
    const food = (
      await db.query<{ id: string }>(
        "select id from categories where name='Food'",
      )
    ).rows[0].id;
    await db.query("select gmail_review($1,'category',$2)", [
      candidate("message-one"),
      food,
    ]);
    assert.ok(
      (
        await db.query<{ category_id: string }>(
          "select category_id from transactions where id=$1 or refund_of=$1",
          [tx],
        )
      ).rows.every((r) => r.category_id === food),
    );
    await assert.rejects(
      db.query("update transactions set amount=2 where id=$1", [tx]),
      /protected/,
    );
    await db.exec(`set request.jwt.claim.sub='${stranger}';`);
    assert.equal(
      (await db.query("select * from gmail_candidates_read")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from gmail_connections")).rows.length,
      0,
    );
    await assert.rejects(
      db.query("select gmail_review($1,'reject')", [
        candidate("unknown-currency"),
      ]),
      /Unauthorized/,
    );
    await db.exec("reset role;");
    await db.exec(
      "insert into gmail_private_tokens select id,revision,'encrypted-fixture',now() from gmail_connections",
    );
    await service();
    const running = await start();
    await auth();
    await db.query("select gmail_disconnect()");
    await service();
    assert.equal(
      (await db.query("select * from gmail_private_tokens")).rows.length,
      0,
    );
    await assert.rejects(
      db.query(
        "select gmail_commit_message($1,'after-disconnect','candidate',$2::jsonb,$3)",
        [running.id, JSON.stringify(c), owner],
      ),
      /no longer authorized/,
    );
    assert.equal(
      (await db.query("select * from transactions where source='gmail'")).rows
        .length,
      4,
    );
    const conn = (
      await db.query<{ id: string; revision: string }>(
        "select id,revision from gmail_connections",
      )
    ).rows[0];
    const state = "fixture-state";
    await db.query(
      "insert into gmail_oauth_states(state_hash,user_id,device_user_id,encrypted_verifier,nonce_hash,connection_id,expected_revision,expires_at) values($1,$2,$3,'v1.fixture','fixture',$4,$5,now()+interval '10 minutes')",
      [state, owner, device, conn.id, conn.revision],
    );
    await db.query(
      "select gmail_store_connection($1,$2,$3,'google-fixture-two','fixture-two@example.com','v1.fixture',$4)",
      [state, owner, device, randomUUID()],
    );
    await assert.rejects(
      db.query(
        "select gmail_store_connection($1,$2,$3,'google-fixture-two','fixture-two@example.com','v1.fixture',$4)",
        [state, owner, device, randomUUID()],
      ),
      /expired or consumed/,
    );
    const current = (
      await db.query<{ revision: string }>(
        "select revision from gmail_connections",
      )
    ).rows[0];
    await db.query(
      "insert into gmail_oauth_states(state_hash,user_id,device_user_id,encrypted_verifier,nonce_hash,connection_id,expected_revision,expires_at) values('expired',$1,$2,'v1.fixture','fixture',$3,$4,now()-interval '1 minute')",
      [owner, device, conn.id, current.revision],
    );
    await assert.rejects(
      db.query(
        "select gmail_store_connection('expired',$1,$2,'google-fixture-two','fixture-two@example.com','v1.fixture',$3)",
        [owner, device, randomUUID()],
      ),
      /expired or consumed/,
    );
    await db.query(
      "insert into gmail_oauth_states(state_hash,user_id,device_user_id,encrypted_verifier,nonce_hash,connection_id,expected_revision,expires_at) values('stale',$1,$2,'v1.fixture','fixture',$3,$4,now()+interval '1 minute')",
      [owner, device, conn.id, conn.revision],
    );
    await assert.rejects(
      db.query(
        "select gmail_store_connection('stale',$1,$2,'google-fixture-two','fixture-two@example.com','v1.fixture',$3)",
        [owner, device, randomUUID()],
      ),
      /Connection changed/,
    );
  } finally {
    await db.close();
  }
});
