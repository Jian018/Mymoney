import "server-only";
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validPushEndpoint } from "./validation";
import { today } from "./finance";
export async function sendPush(
  db: SupabaseClient,
  userId: string,
  type: string,
) {
  if (
    !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
    !process.env.VAPID_PRIVATE_KEY ||
    !process.env.VAPID_SUBJECT
  )
    throw new Error("Configure all VAPID environment variables.");
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  const { data: subscriptions, error: readError } = await db
    .from("push_subscriptions")
    .select("*")
    .eq("user_id", userId);
  if (readError) throw new Error(readError.message);
  if (!subscriptions.length)
    throw new Error(
      "No active push subscription. Enable notifications on this device first.",
    );
  const date = today();
  const { data: log, error } = await db
    .from("notification_logs")
    .insert({
      user_id: userId,
      notification_type: type,
      notification_date: date,
      status: "pending",
    })
    .select("id")
    .single();
  if (error?.code === "23505")
    return { accepted: 0, failed: 0, duplicate: true };
  if (error) throw new Error(error.message);
  let accepted = 0,
    failed = 0;
  for (const subscription of subscriptions) {
    try {
      if (!validPushEndpoint(subscription.endpoint))
        throw new Error("Invalid push endpoint");
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify({
          title:
            type === "daily"
              ? "Your daily money moment"
              : "My Money · Push test",
          body:
            type === "daily"
              ? "Take a minute to review today’s spending."
              : "Your push provider accepted this test. If you see it, device delivery works.",
          url: "/?checkin=1",
          tag: type === "daily" ? "daily-" + date : "push-test",
        }),
        { TTL: 3600, timeout: 10000 },
      );
      accepted++;
    } catch (error) {
      failed++;
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        const cleanup = await db
          .from("push_subscriptions")
          .delete()
          .eq("id", subscription.id);
        if (cleanup.error) throw new Error(cleanup.error.message);
      }
    }
  }
  const result = await db
    .from("notification_logs")
    .update({
      status: failed === 0 ? "accepted" : accepted ? "partial" : "failed",
      sent_at: accepted ? new Date().toISOString() : null,
    })
    .eq("id", log!.id);
  if (result.error) throw new Error(result.error.message);
  return { accepted, failed, duplicate: false };
}
