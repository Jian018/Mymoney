import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/supabase/server";
import { checkOrigin, failure } from "@/lib/http";
import { paypalToken, paypalFingerprint } from "@/lib/import/paypal";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { ownerId } = await requireOwner();
    const input = await request.json();
    if (input.provider !== "paypal" || input.confirmBusiness !== true)
      throw new Error(
        "Confirm that this live app belongs to your own PayPal Business account.",
      );
    await paypalToken(); // Official OAuth2 client-credentials grant; no fake consumer OAuth redirect.
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error } = await db
      .from("import_connections")
      .upsert({
        user_id: ownerId,
        provider: "paypal",
        app_fingerprint: paypalFingerprint(),
        authorized_at: new Date().toISOString(),
      });
    if (error)
      throw new Error(
        "Could not save Business API authorization. Run migration 003.",
      );
    return NextResponse.json({
      ok: true,
      message:
        "Official OAuth scope verified. Press Sync to request history; provider reporting access will be checked then.",
    });
  } catch (error) {
    return failure(error);
  }
}
