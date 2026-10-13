import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/supabase/server";
import { failure } from "@/lib/http";
import { configured, connection } from "@/lib/gmail/server";
export async function GET() {
  try {
    const { db, ownerId } = await requireOwner();
    const c = await connection(db, ownerId);
    const [runs, pending, saved, candidates] = await Promise.all([
      db
        .from("gmail_runs_read")
        .select("*")
        .eq("user_id", ownerId)
        .order("started_at", { ascending: false })
        .limit(1),
      db
        .from("gmail_candidates_read")
        .select("*", { count: "exact" })
        .eq("user_id", ownerId)
        .eq("review_status", "pending")
        .order("created_at")
        .order("id")
        .limit(100),
      db
        .from("gmail_candidates_read")
        .select("*", { count: "exact" })
        .eq("user_id", ownerId)
        .eq("review_status", "approved")
        .neq("payment_status", "refund")
        .order("created_at")
        .order("id")
        .limit(30),
      db
        .from("gmail_candidates_read")
        .select("*")
        .eq("user_id", ownerId)
        .neq("review_status", "pending")
        .or("review_status.neq.approved,payment_status.eq.refund")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    if (runs.error || candidates.error || pending.error || saved.error)
      throw new Error("Could not load Gmail history.");
    const run = runs.data?.[0] ?? null;
    return NextResponse.json(
      {
        configured: configured(),
        connection: c
          ? {
              id: c.id,
              email: c.email,
              connection_status: c.connection_status,
              last_sync_at: c.last_sync_at,
            }
          : null,
        run,
        candidates: [
          ...(pending.data ?? []),
          ...(saved.data ?? []),
          ...(candidates.data ?? []),
        ],
        pending_count: pending.count ?? 0,
        saved_count: saved.count ?? 0,
        active:
          run?.status === "running" &&
          Date.parse(run.lease_expires_at) > Date.now(),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
