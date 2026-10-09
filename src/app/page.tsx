import { redirect } from "next/navigation";
import { configured, requireOwner } from "@/lib/supabase/server";
import MoneyApp from "@/components/money-app";
export const dynamic = "force-dynamic";
export default async function Page() {
  if (!configured()) redirect("/login");
  let email = "";
  try {
    email = (await requireOwner()).user.email ?? "";
  } catch {
    redirect("/login");
  }
  return <MoneyApp email={email} />;
}
