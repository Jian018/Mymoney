import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("PostgreSQL migration, owner RLS, exact money, CRUD and uniqueness", async () => {
  const db = new PGlite();
  const owner = "11111111-1111-4111-8111-111111111111",
    stranger = "22222222-2222-4222-8222-222222222222";
  try {
    // Local PostgreSQL engine; emulate only Supabase's auth roles and uid function.
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
      grant usage on schema public,auth to anon,authenticated; grant execute on function auth.uid() to authenticated;
      insert into auth.users values ('${owner}'),('${stranger}');`);
    const sql = await readFile(
      new URL("../supabase/migrations/001_initial.sql", import.meta.url),
      "utf8",
    );
    // gen_random_uuid() is built into PostgreSQL; pgcrypto packaging is Supabase-specific.
    await db.exec(sql.replace("create extension if not exists pgcrypto;", ""));
    await db.exec(`insert into public.app_owner values(true,'${owner}');`);
    const category = (
      await db.query<{ id: string }>(
        `select id from categories where user_id=$1 and name='Food'`,
        [owner],
      )
    ).rows[0].id;
    const income = (
      await db.query<{ id: string }>(
        `select id from categories where user_id=$1 and name='Salary'`,
        [owner],
      )
    ).rows[0].id;
    await db.exec(
      `set role authenticated; set request.jwt.claim.sub = '${owner}';`,
    );
    const requestId = "33333333-3333-4333-8333-333333333333";
    const insert = `insert into transactions(user_id,request_id,transaction_type,category_id,amount,currency,transaction_date) values($1,$2,'expense',$3,'0.10','MYR','2026-10-08')`;
    await db.query(insert, [owner, requestId, category]);
    await db.query(insert + " on conflict(user_id,request_id) do nothing", [
      owner,
      requestId,
      category,
    ]);
    assert.equal(
      (await db.query("select * from transactions_read")).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query<{ amount: string }>(
          "select amount from transactions_read",
        )
      ).rows[0].amount,
      "0.10",
    );
    await db.query(
      `update transactions set amount='0.20' where request_id=$1`,
      [requestId],
    );
    assert.equal(
      (
        await db.query<{ amount: string }>(
          "select amount from transactions_read",
        )
      ).rows[0].amount,
      "0.20",
    );
    await assert.rejects(
      db.query(
        `insert into transactions(user_id,transaction_type,category_id,amount,currency,transaction_date) values($1,'expense',$2,'1.00','MYR','2026-10-08')`,
        [owner, income],
      ),
      /foreign key/i,
    );
    await assert.rejects(
      db.query(
        `insert into transactions(user_id,transaction_type,category_id,amount,currency,transaction_date) values($1,'expense',$2,'0','MYR','2026-10-08')`,
        [owner, category],
      ),
      /check constraint/i,
    );
    await db.query(
      `insert into budgets(user_id,month,currency,limit_amount) values($1,'2026-10-01','MYR','100.00')`,
      [owner],
    );
    await assert.rejects(
      db.query(
        `insert into budgets(user_id,month,currency,limit_amount) values($1,'2026-10-01','MYR','200.00')`,
        [owner],
      ),
      /duplicate key/i,
    );
    await db.query(
      `insert into budgets(user_id,month,currency,limit_amount) values($1,'2026-10-01','SGD','100.00')`,
      [owner],
    );
    await db.query(
      `insert into daily_checkins(user_id,checkin_date,status,has_unrecorded_spending,has_impulse_purchase) values($1,'2026-10-08','completed',false,false)`,
      [owner],
    );
    await assert.rejects(
      db.query(
        `insert into daily_checkins(user_id,checkin_date,status,has_unrecorded_spending,has_impulse_purchase) values($1,'2026-10-08','completed',false,false)`,
        [owner],
      ),
      /duplicate key/i,
    );
    await db.query(
      `insert into notification_logs(user_id,notification_type,notification_date,status) values($1,'daily','2026-10-08','pending')`,
      [owner],
    );
    await assert.rejects(
      db.query(
        `insert into notification_logs(user_id,notification_type,notification_date,status) values($1,'daily','2026-10-08','pending')`,
        [owner],
      ),
      /duplicate key/i,
    );
    await db.exec(`set request.jwt.claim.sub = '${stranger}';`);
    for (const table of [
      "profiles",
      "categories",
      "transactions",
      "transactions_read",
      "budgets",
      "budgets_read",
      "daily_checkins",
      "notification_preferences",
      "push_subscriptions",
      "notification_logs",
    ])
      assert.equal(
        (await db.query("select * from " + table)).rows.length,
        0,
        `${table} must be private`,
      );
    await assert.rejects(
      db.query(insert, [
        owner,
        "44444444-4444-4444-8444-444444444444",
        category,
      ]),
      /row-level security/i,
    );
    await db.exec("reset role; set role anon;");
    await assert.rejects(
      db.query("select * from transactions_read"),
      /permission denied/i,
    );
    await db.exec(
      `reset role; set role authenticated; set request.jwt.claim.sub = '${owner}';`,
    );
    await db.query("delete from transactions where request_id=$1", [requestId]);
    assert.equal(
      (await db.query("select * from transactions_read")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
