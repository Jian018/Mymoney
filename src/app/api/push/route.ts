import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/supabase/server";
import { checkOrigin, failure } from "@/lib/http";
import { subscriptionSchema } from "@/lib/validation";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db, user } = await requireOwner();
    const sub = subscriptionSchema.parse(await request.json());
    const { error } = await db
      .from("push_subscriptions")
      .upsert(
        {
          user_id: user.id,
          endpoint: sub.endpoint,
          p256dh: sub.keys.p256dh,
          auth: sub.keys.auth,
        },
        { onConflict: "endpoint" },
      );
    if (error) throw new Error(error.message);
    const result = await db
      .from("notification_preferences")
      .update({ push_enabled: true })
      .eq("user_id", user.id);
    if (result.error) throw new Error(result.error.message);
    return NextResponse.json({ saved: true });
  } catch (error) {
    return failure(error);
  }
}
export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const { db, user } = await requireOwner();
    const { error } = await db
      .from("push_subscriptions")
      .delete()
      .eq("user_id", user.id);
    if (error) throw new Error(error.message);
    const result = await db
      .from("notification_preferences")
      .update({ push_enabled: false })
      .eq("user_id", user.id);
    if (result.error) throw new Error(result.error.message);
    return NextResponse.json({ disabled: true });
  } catch (error) {
    return failure(error);
  }
}
