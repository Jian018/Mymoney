import type { Credentials } from "google-auth-library";
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/supabase/server";
import { checkOrigin, failure } from "@/lib/http";
import { connection, privateDb, tokenContext } from "@/lib/gmail/server";
import { decrypt } from "@/lib/gmail/crypto";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db, ownerId } = await requireOwner(),
      c = await connection(db, ownerId);
    let token: string | undefined;
    if (c)
      try {
        const stored = await privateDb()
          .from("gmail_private_tokens")
          .select("ciphertext")
          .eq("connection_id", c.id)
          .eq("connection_revision", c.revision)
          .maybeSingle();
        if (stored.data) {
          const t = decrypt<Credentials>(
            stored.data.ciphertext,
            tokenContext(c),
          );
          token = t.refresh_token ?? t.access_token ?? undefined;
        }
      } catch {
        /* Local invalidation must still work when token decryption/configuration fails. */
      }
    const removed = await db.rpc("gmail_disconnect");
    if (removed.error)
      throw new Error("Could not disconnect Gmail. Try again.");
    let revoked = !c || c.connection_status === "disconnected";
    if (token)
      try {
        const response = await fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }),
          signal: AbortSignal.timeout(10_000),
        });
        revoked = response.ok;
      } catch {}
    return NextResponse.json({
      disconnected: true,
      revoked,
      message: revoked
        ? "Gmail disconnected. Saved expenses and audit history are retained."
        : "Local authorization removed. Google revocation could not be confirmed; also remove My Money access in your Google Account permissions.",
    });
  } catch (error) {
    return failure(error);
  }
}
