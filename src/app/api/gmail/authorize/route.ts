import { randomBytes, randomUUID, createHash } from "node:crypto";
import { CodeChallengeMethod } from "google-auth-library";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireOwner } from "@/lib/supabase/server";
import { checkOrigin, failure } from "@/lib/http";
import {
  connection,
  GMAIL_SCOPE,
  oauth,
  privateDb,
  STATE_COOKIE,
} from "@/lib/gmail/server";
import { digest, encrypt } from "@/lib/gmail/crypto";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db, user, ownerId } = await requireOwner();
    const client = oauth();
    const c = await connection(db, ownerId),
      state = randomBytes(32).toString("base64url"),
      verifier = randomBytes(64).toString("base64url"),
      nonce = randomBytes(32).toString("base64url");
    const admin = privateDb();
    await admin
      .from("gmail_oauth_states")
      .delete()
      .lt("expires_at", new Date().toISOString());
    const saved = await admin.from("gmail_oauth_states").insert({
      state_hash: digest(state),
      user_id: ownerId,
      device_user_id: user.id,
      encrypted_verifier: encrypt({ verifier }, "oauth:" + digest(state)),
      nonce_hash: digest(nonce),
      connection_id: c?.id ?? randomUUID(),
      expected_revision: c?.revision ?? null,
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    });
    if (saved.error)
      throw new Error(
        "Could not begin Gmail authorization. Check database migration and server configuration.",
      );
    (await cookies()).set(STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/gmail",
      maxAge: 600,
    });
    const url = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["openid", "email", GMAIL_SCOPE],
      state,
      nonce,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: CodeChallengeMethod.S256,
      include_granted_scopes: false,
    });
    return NextResponse.json(
      { url },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
