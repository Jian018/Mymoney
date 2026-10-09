import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
export function supabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
export async function serverClient() {
  if (!supabaseConfigured())
    throw new Error(
      "Configure the Supabase URL and publishable key before binding a device.",
    );
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (values) => {
          try {
            values.forEach(({ name, value, options }) =>
              jar.set(name, value, options),
            );
          } catch {
            /* Server Components cannot mutate cookies; proxy refreshes them. */
          }
        },
      },
    },
  );
}
export async function requireOwner() {
  if (!supabaseConfigured() || !process.env.ALLOWED_USER_ID)
    throw new Error("Unauthorized");
  const db = await serverClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) throw new Error("Unauthorized");
  const resolved = await db.rpc("current_owner_id");
  if (resolved.error)
    throw new Error(
      "Run database migration 002_device_access.sql before using device access.",
    );
  const ownerId = resolved.data as string | null;
  if (
    !ownerId ||
    !process.env.ALLOWED_USER_ID ||
    ownerId !== process.env.ALLOWED_USER_ID
  )
    throw new Error("Unauthorized");
  return { db, user: data.user, ownerId };
}
