import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { OAuth2Client, type Credentials } from "google-auth-library";
import { decrypt, encrypt } from "./crypto";
import type { GmailConnection, GmailMessage } from "./types";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const STATE_COOKIE = "gmail-oauth-state";
export function configured() {
  return [
    "APP_URL",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GMAIL_TOKEN_ENCRYPTION_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ].every((k) => Boolean(process.env[k]));
}
export function appUrl() {
  const url = new URL(process.env.APP_URL ?? "");
  if (
    url.protocol !== "https:" &&
    !(process.env.NODE_ENV !== "production" && url.hostname === "localhost")
  )
    throw new Error("Gmail requires a configured HTTPS APP_URL.");
  return url.origin;
}
export function oauth() {
  if (!configured())
    throw new Error(
      "Gmail is not configured. Complete GMAIL_SYNC.md setup first.",
    );
  return new OAuth2Client({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: appUrl() + "/api/gmail/callback",
    transporterOptions: { timeout: 15_000, retry: false },
  });
}
export function privateDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
export type Connection = GmailConnection & {
  user_id: string;
  revision: string;
};
export function tokenContext(
  c: Pick<Connection, "id" | "user_id" | "google_account_id">,
) {
  return `gmail:${c.user_id}:${c.google_account_id}:${c.id}`;
}
export async function connection(db: SupabaseClient, ownerId: string) {
  const { data, error } = await db
    .from("gmail_connections")
    .select("*")
    .eq("user_id", ownerId)
    .maybeSingle();
  if (error)
    throw new Error(
      "Run migration 004_gmail_expense_sync.sql before using Gmail.",
    );
  return data as Connection | null;
}
export class ReconnectError extends Error {
  constructor() {
    super("Gmail authorization expired or was revoked. Reconnect Gmail.");
  }
}
export async function reconnect(c: Connection) {
  const admin = privateDb();
  await admin
    .from("gmail_connections")
    .update({ connection_status: "reconnect_required" })
    .eq("id", c.id)
    .eq("revision", c.revision);
  await admin
    .from("gmail_private_tokens")
    .delete()
    .eq("connection_id", c.id)
    .eq("connection_revision", c.revision);
}
export async function authorizedClient(c: Connection) {
  const admin = privateDb();
  const { data, error } = await admin
    .from("gmail_private_tokens")
    .select("ciphertext")
    .eq("connection_id", c.id)
    .eq("connection_revision", c.revision)
    .maybeSingle();
  if (error || !data) throw new ReconnectError();
  let tokens: Credentials;
  try {
    tokens = decrypt<Credentials>(data.ciphertext, tokenContext(c));
  } catch {
    throw new ReconnectError();
  }
  const client = oauth();
  client.setCredentials(tokens);
  try {
    const result = await client.getAccessToken();
    if (!result.token) throw new ReconnectError();
    // CAS ensures a concurrent disconnect/account replacement cannot recreate tokens.
    const saved = await admin
      .from("gmail_private_tokens")
      .update({
        ciphertext: encrypt(client.credentials, tokenContext(c)),
        updated_at: new Date().toISOString(),
      })
      .eq("connection_id", c.id)
      .eq("connection_revision", c.revision)
      .select("connection_id");
    if (saved.error || !saved.data?.length) throw new ReconnectError();
    return result.token;
  } catch (error) {
    if (
      error instanceof ReconnectError ||
      (error as { response?: { status?: number } })?.response?.status === 400 ||
      (error as { response?: { status?: number } })?.response?.status === 401
    ) {
      await reconnect(c);
      throw new ReconnectError();
    }
    throw new Error(
      "Google authorization could not be refreshed. Try again later.",
    );
  }
}
export async function gmailGet<T>(
  accessToken: string,
  path: string,
  params: Record<string, string> = {},
) {
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/" + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401) throw new ReconnectError();
  if (!response.ok)
    throw new Error(
      response.status === 403
        ? "Gmail permission was denied or its API is disabled. Check Google Cloud configuration and reconnect."
        : response.status === 429
          ? "Gmail rate limit reached. Retrieve again later."
          : "Gmail could not retrieve a message. Try again later.",
    );
  return (await response.json()) as T;
}
export function message(
  accessToken: string,
  id: string,
  format: "metadata" | "full",
) {
  return gmailGet<GmailMessage>(
    accessToken,
    "messages/" + encodeURIComponent(id),
    { format },
  );
}
