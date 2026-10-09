import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { sendPush } from "@/lib/push";
import { today } from "@/lib/finance";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET
    ? Buffer.from("Bearer " + process.env.CRON_SECRET)
    : null;
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  if (
    !expected ||
    expected.length !== actual.length ||
    !timingSafeEqual(expected, actual)
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.ALLOWED_USER_ID
  )
    return NextResponse.json(
      { error: "Cron configuration missing" },
      { status: 503 },
    );
  try {
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const userId = process.env.ALLOWED_USER_ID;
    const owner = await db
      .from("app_owner")
      .select("user_id")
      .eq("user_id", userId)
      .single();
    if (owner.error) throw new Error("Owner configuration mismatch");
    const prefs = await db
      .from("notification_preferences")
      .select("*")
      .eq("user_id", userId)
      .single();
    if (prefs.error) throw new Error(prefs.error.message);
    if (!prefs.data.push_enabled || !prefs.data.daily_reminder_enabled)
      return NextResponse.json({ skipped: "disabled" });
    const checkin = await db
      .from("daily_checkins")
      .select("id")
      .eq("user_id", userId)
      .eq("checkin_date", today())
      .maybeSingle();
    if (checkin.error) throw new Error(checkin.error.message);
    if (checkin.data)
      return NextResponse.json({ skipped: "already completed" });
    return NextResponse.json(await sendPush(db, userId, "daily"));
  } catch {
    return NextResponse.json(
      {
        error:
          "Reminder failed. Check server configuration, database and notification logs.",
      },
      { status: 503 },
    );
  }
}
