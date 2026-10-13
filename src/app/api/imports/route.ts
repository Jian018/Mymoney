import { NextResponse } from "next/server";
import { z } from "zod";
import { sources } from "@/lib/import/catalog";
import {
  paypalConfigured,
  paypalFingerprint,
  paypalAdapter,
} from "@/lib/import/paypal";
import { statementImport, rpcRows } from "@/lib/import/service";
import { requireOwner } from "@/lib/supabase/server";
import { checkOrigin, failure } from "@/lib/http";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET() {
  try {
    const { db } = await requireOwner();
    const results = await Promise.all([
      db
        .from("import_items_read")
        .select("*")
        .eq("status", "pending")
        .order("imported_at", { ascending: false })
        .limit(100),
      db
        .from("import_batches")
        .select("*")
        .order("imported_at", { ascending: false })
        .limit(10),
      db.from("import_connections").select("provider,app_fingerprint"),
    ]);
    for (const result of results)
      if (result.error)
        throw new Error(
          "Auto Import needs migration 003_auto_import.sql. Run it in Supabase SQL Editor.",
        );
    const connected =
      paypalConfigured() &&
      results[2].data?.some(
        (c) =>
          c.provider === "paypal" && c.app_fingerprint === paypalFingerprint(),
      );
    return NextResponse.json(
      {
        sources: sources.map((s) =>
          s.id === "paypal" && paypalConfigured()
            ? {
                ...s,
                status: connected ? "Available" : "Authorization Required",
              }
            : s,
        ),
        items: results[0].data,
        batches: results[1].data,
        connected,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
const schema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("statement"),
    request_id: z.uuid(),
    source: z.string().max(30),
    account: z.string().trim().min(1).max(100),
    csv: z.string().min(1).max(2_000_000),
  }),
  z.object({
    mode: z.literal("sync"),
    request_id: z.uuid(),
    source: z.literal("paypal"),
  }),
]);
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db } = await requireOwner();
    if (Number(request.headers.get("content-length") || 0) > 2_100_000)
      throw new Error("Import request is too large.");
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 2_100_000)
      throw new Error("Import request is too large.");
    const input = schema.parse(JSON.parse(raw));
    let rows, history, account;
    if (input.mode === "statement") {
      ({ rows, history } = statementImport(input.source, input.csv));
      account = input.account;
    } else {
      const { data, error } = await db
        .from("import_connections")
        .select("app_fingerprint")
        .eq("provider", "paypal")
        .maybeSingle();
      if (error || !data || data.app_fingerprint !== paypalFingerprint())
        throw new Error(
          "Authorize the configured live Business API before synchronizing.",
        );
      ({ rows, history, account } = await paypalAdapter.synchronize());
    }
    const { data, error } = await db.rpc("run_import", {
      p_request: input.request_id,
      p_source: input.source,
      p_account: account,
      p_history: history,
      p_rows: rpcRows(rows),
    });
    if (error) throw new Error(error.message);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
