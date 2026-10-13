import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOwner } from "@/lib/supabase/server";
import { checkOrigin, failure } from "@/lib/http";
import { synchronize } from "@/lib/gmail/sync";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db, ownerId } = await requireOwner();
    const { request_id } = z
      .object({ request_id: z.uuid() })
      .parse(await request.json());
    const result = await synchronize(db, ownerId, request_id);
    const run = await db
      .from("gmail_runs_read")
      .select("*")
      .eq("id", result.id)
      .single();
    if (run.error)
      throw new Error("Could not load scan results; refresh Dashboard.");
    return NextResponse.json(
      { run: run.data, existing: result.existing ?? false },
      {
        status: run.data.status === "running" ? 202 : 200,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    return failure(error);
  }
}
