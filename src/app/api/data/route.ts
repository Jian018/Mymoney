import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/supabase/server";
import { failure } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const { db, ownerId } = await requireOwner();
    async function all(table: string, order: string) {
      const rows: Record<string, unknown>[] = [];
      for (let start = 0; ; start += 500) {
        const { data, error } = await db
          .from(table)
          .select("*")
          .eq("user_id", ownerId)
          .order(order, { ascending: false })
          .order("id")
          .range(start, start + 499);
        if (error) throw new Error(error.message);
        rows.push(...data);
        if (data.length < 500) break;
      }
      return rows;
    }
    const [
      transactions,
      budgets,
      categories,
      checkins,
      notifications,
      profileResult,
      preferencesResult,
    ] = await Promise.all([
      all("transactions_read", "transaction_date"),
      all("budgets_read", "month"),
      all("categories", "created_at"),
      all("daily_checkins", "checkin_date"),
      all("notification_logs", "notification_date"),
      db
        .from("profiles")
        .select("display_name,timezone,default_currency")
        .eq("id", ownerId)
        .single(),
      db
        .from("notification_preferences")
        .select("daily_reminder_enabled,reminder_time,timezone,push_enabled")
        .eq("user_id", ownerId)
        .single(),
    ]);
    if (profileResult.error || preferencesResult.error)
      throw new Error(
        "Account initialization missing. Run the SQL setup and confirm app_owner.",
      );
    return NextResponse.json({
      transactions,
      budgets,
      categories,
      checkins,
      notifications,
      profile: profileResult.data,
      preferences: preferencesResult.data,
    });
  } catch (error) {
    return failure(error);
  }
}
