import { configured } from "@/lib/supabase/server";
import Login from "@/components/login";
export default function LoginPage() {
  return <Login configured={configured()} />;
}
