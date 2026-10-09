import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET() {
  try {
    const db = await serverClient();
    const { data, error } = await db.auth.getUser();
    if (error || !data.user)
      return NextResponse.json(
        { error: "No device session. Bind this device first." },
        { status: 401 },
      );
    const resolved = await db.rpc("current_owner_id");
    if (resolved.error)
      return NextResponse.json(
        { error: "Apply 002_device_access.sql in Supabase, then check again." },
        { status: 503 },
      );
    const authorized = Boolean(
      resolved.data &&
      process.env.ALLOWED_USER_ID &&
      resolved.data === process.env.ALLOWED_USER_ID,
    );
    return NextResponse.json({
      deviceId: data.user.id,
      authorized,
      ownerConfigured: Boolean(process.env.ALLOWED_USER_ID),
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "Unable to check access. Confirm Supabase configuration and connectivity, then retry.",
      },
      { status: 503 },
    );
  }
}
