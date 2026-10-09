import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const owner = "11111111-1111-4111-8111-111111111111";
const device = "22222222-2222-4222-8222-222222222222";
const stranger = "33333333-3333-4333-8333-333333333333";
async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated;
    grant execute on function auth.uid() to authenticated;
    insert into auth.users values('${owner}'),('${device}'),('${stranger}');`);
  for (const name of ["001_initial.sql", "002_device_access.sql"]) {
    const sql = await readFile(
      new URL("../supabase/migrations/" + name, import.meta.url),
      "utf8",
    );
    await db.exec(sql.replace("create extension if not exists pgcrypto;", ""));
  }
  return db;
}
async function approve(db: PGlite, id: string) {
  const script = await readFile(
    new URL("../supabase/setup-device.sql", import.meta.url),
    "utf8",
  );
  await db.exec(script.replace("00000000-0000-0000-0000-000000000000", id));
}

test("approved device accesses existing owner records; strangers cannot self-authorize; revocation is immediate", async () => {
  const db = await database();
  try {
    await db.exec(`insert into app_owner values(true,'${owner}');`);
    const category = (
      await db.query<{ id: string }>(
        `select id from categories where user_id=$1 and name='Food'`,
        [owner],
      )
    ).rows[0].id;
    await db.query(
      `insert into transactions(user_id,transaction_type,category_id,amount,currency,transaction_date) values($1,'expense',$2,'12.34','MYR','2026-10-09')`,
      [owner, category],
    );
    await approve(db, device);
    // Repeated approval is idempotent and does not create a second ledger.
    await approve(db, device);
    assert.equal((await db.query("select * from app_owner")).rows.length, 1);
    assert.equal(
      (await db.query("select * from authorized_devices")).rows.length,
      1,
    );
    await db.exec(
      `set role authenticated; set request.jwt.claim.sub='${device}';`,
    );
    assert.equal(
      (await db.query<{ id: string }>("select current_owner_id() as id"))
        .rows[0].id,
      owner,
    );
    assert.equal(
      (
        await db.query<{ amount: string }>(
          "select amount from transactions_read",
        )
      ).rows[0].amount,
      "12.34",
    );
    await db.query(`update transactions set amount='15.00' where user_id=$1`, [
      owner,
    ]);
    assert.equal(
      (
        await db.query<{ amount: string }>(
          "select amount from transactions_read",
        )
      ).rows[0].amount,
      "15.00",
    );
    await assert.rejects(
      db.query(
        `insert into authorized_devices(device_user_id,owner_user_id) values($1,$2)`,
        [stranger, owner],
      ),
      /permission denied/i,
    );
    await db.exec(`set request.jwt.claim.sub='${stranger}';`);
    assert.equal(
      (await db.query<{ id: string | null }>("select current_owner_id() as id"))
        .rows[0].id,
      null,
    );
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
      assert.equal((await db.query("select * from " + table)).rows.length, 0);
    await assert.rejects(
      db.query(
        `insert into transactions(user_id,transaction_type,category_id,amount,currency,transaction_date) values($1,'expense',$2,'1.00','MYR','2026-10-09')`,
        [owner, category],
      ),
      /row-level security/i,
    );
    await db.exec(
      `reset role; delete from authorized_devices where device_user_id='${device}'; set role authenticated; set request.jwt.claim.sub='${device}';`,
    );
    assert.equal(
      (await db.query("select * from transactions_read")).rows.length,
      0,
    );
    await db.exec("reset role;");
    // The ledger was not deleted or moved when access was revoked.
    assert.equal(
      (await db.query<{ user_id: string }>("select user_id from transactions"))
        .rows[0].user_id,
      owner,
    );
  } finally {
    await db.close();
  }
});

test("first binding initializes a new ledger; replacement device keeps the same ledger owner", async () => {
  const db = await database();
  try {
    await approve(db, device);
    assert.equal(
      (await db.query<{ user_id: string }>("select user_id from app_owner"))
        .rows[0].user_id,
      device,
    );
    assert.equal((await db.query("select * from categories")).rows.length, 8);
    await approve(db, stranger);
    assert.equal(
      (await db.query<{ user_id: string }>("select user_id from app_owner"))
        .rows[0].user_id,
      device,
    );
    await db.exec(
      `set role authenticated; set request.jwt.claim.sub='${stranger}';`,
    );
    assert.equal(
      (await db.query<{ id: string }>("select current_owner_id() as id"))
        .rows[0].id,
      device,
    );
    await db.exec(
      `reset role; delete from authorized_devices where device_user_id='${device}'; set role authenticated; set request.jwt.claim.sub='${device}';`,
    );
    assert.equal(
      (await db.query<{ id: string | null }>("select current_owner_id() as id"))
        .rows[0].id,
      null,
    );
  } finally {
    await db.close();
  }
});
