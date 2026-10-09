import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
export function configured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
    process.env.ALLOWED_USER_ID,
  );
}
export async function serverClient() {
  if (!configured())
    throw new Error(
      "Configure Supabase and ALLOWED_USER_ID before signing in.",
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
  const db = await serverClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user || data.user.id !== process.env.ALLOWED_USER_ID)
    throw new Error("Unauthorized");
  return { db, user: data.user };
}
