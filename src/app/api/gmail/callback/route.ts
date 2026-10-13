import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireOwner } from "@/lib/supabase/server";
import {
  appUrl,
  GMAIL_SCOPE,
  oauth,
  privateDb,
  STATE_COOKIE,
  tokenContext,
} from "@/lib/gmail/server";
import { decrypt, digest, encrypt, equalSecret } from "@/lib/gmail/crypto";
export async function GET(request: Request) {
  let result = "authorization_failed";
  try {
    const { user, ownerId } = await requireOwner(),
      url = new URL(request.url),
      state = url.searchParams.get("state") ?? "",
      jar = await cookies();
    if (!state || !equalSecret(state, jar.get(STATE_COOKIE)?.value ?? ""))
      throw new Error("Invalid state");
    const admin = privateDb(),
      saved = await admin
        .from("gmail_oauth_states")
        .select("*")
        .eq("state_hash", digest(state))
        .eq("user_id", ownerId)
        .eq("device_user_id", user.id)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
    if (saved.error || !saved.data) throw new Error("Expired state");
    if (url.searchParams.has("error")) {
      await admin
        .from("gmail_oauth_states")
        .delete()
        .eq("state_hash", digest(state));
      result = "consent_cancelled";
    } else {
      const code = url.searchParams.get("code");
      if (!code) throw new Error("Missing code");
      const client = oauth(),
        { verifier } = decrypt<{ verifier: string }>(
          saved.data.encrypted_verifier,
          "oauth:" + digest(state),
        );
      const { tokens } = await client.getToken({
        code,
        codeVerifier: verifier,
      });
      if (
        !tokens.id_token ||
        !tokens.refresh_token ||
        !tokens.scope?.split(" ").includes(GMAIL_SCOPE)
      )
        throw new Error("Missing authorization");
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const identity = ticket.getPayload();
      if (
        !identity?.sub ||
        !identity.email ||
        !identity.email_verified ||
        !equalSecret(
          digest(
            String((identity as unknown as { nonce?: string }).nonce ?? ""),
          ),
          saved.data.nonce_hash,
        )
      )
        throw new Error("Invalid Google identity");
      const ciphertext = encrypt(
        tokens,
        tokenContext({
          id: saved.data.connection_id,
          user_id: ownerId,
          google_account_id: identity.sub,
        }),
      );
      const written = await admin.rpc("gmail_store_connection", {
        p_state: digest(state),
        p_owner: ownerId,
        p_device: user.id,
        p_google: identity.sub,
        p_email: identity.email,
        p_ciphertext: ciphertext,
        p_revision: randomUUID(),
      });
      if (written.error) throw new Error("Connection changed");
      result = "connected";
    }
  } catch {
    /* Never return Google responses, codes or token data to the browser/logs. */
  }
  let destination: string;
  try {
    destination = appUrl();
  } catch {
    destination = new URL(request.url).origin;
  }
  const response = NextResponse.redirect(destination + "/?gmail=" + result);
  response.cookies.set(STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/gmail",
    maxAge: 0,
  });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
