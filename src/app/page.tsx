import { supabaseConfigured, requireOwner } from "@/lib/supabase/server";
import MoneyApp from "@/components/money-app";
import DeviceAccess from "@/components/device-access";
export const dynamic = "force-dynamic";
export default async function Page() {
  if (!supabaseConfigured()) return <DeviceAccess configured={false} />;
  try {
    const { user } = await requireOwner();
    return <MoneyApp deviceId={user.id} />;
  } catch {
    return <DeviceAccess configured />;
  }
}
