import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOwner } from "@/lib/supabase/server";
import { failure } from "@/lib/http";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const offset = z.coerce
        .number()
        .int()
        .min(0)
        .max(1_000_000)
        .parse(params.get("offset") ?? 0),
      status = z
        .enum(["pending", "approved"])
        .parse(params.get("status") ?? "pending");
    const { db, ownerId } = await requireOwner();
    let query = db
      .from("gmail_candidates_read")
      .select("*")
      .eq("user_id", ownerId)
      .eq("review_status", status);
    if (status === "approved") query = query.neq("payment_status", "refund");
    const r = await query
      .order("created_at")
      .order("id")
      .range(offset, offset + 99);
    if (r.error) throw new Error("Could not load review queue.");
    return NextResponse.json(
      { candidates: r.data },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
