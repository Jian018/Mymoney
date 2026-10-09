import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/supabase/server";
import { checkOrigin, failure } from "@/lib/http";
import { sendPush } from "@/lib/push";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db, ownerId } = await requireOwner();
    const bucket = Math.floor(Date.now() / 60000);
    return NextResponse.json(await sendPush(db, ownerId, "test:" + bucket));
  } catch (error) {
    return failure(error);
  }
}
