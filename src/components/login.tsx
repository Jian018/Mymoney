"use client";
import { useState } from "react";
import { ArrowUpRight, LockKeyhole } from "lucide-react";
import { browserClient } from "@/lib/supabase/browser";
import { ViewportBridge } from "./pwa";
export default function Login({ configured }: { configured: boolean }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !configured) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await browserClient().auth.signInWithPassword({
        email: String(form.get("email")).trim(),
        password: String(form.get("password")),
      });
      if (result.error) throw result.error;
      const access = await fetch("/api/data", { cache: "no-store" });
      if (!access.ok) {
        await browserClient().auth.signOut();
        throw new Error(
          "This account is not authorized or account setup is incomplete.",
        );
      }
      window.location.assign("/");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to sign in. Please retry.",
      );
      setBusy(false);
    }
  }
  return (
    <main className="login shell">
      <ViewportBridge />
      <div className="login-scroll">
        <div className="brandmark">
          <ArrowUpRight size={38} />
        </div>
        <p className="eyebrow">MY MONEY</p>
        <h1>
          A little clarity.
          <br />A lot more calm.
        </h1>
        <p className="muted">
          Your money, thoughtfully managed.
          <br />
          Sign in to your private space.
        </p>
        <form onSubmit={login} className="card login-form">
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              disabled={!configured || busy}
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={!configured || busy}
            />
          </label>
          {!configured && (
            <p className="alert">
              Setup required: configure Supabase and the sole account UUID. See
              README.md. No demo data is used.
            </p>
          )}
          {error && (
            <p role="alert" className="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={!configured || busy}>
            {busy ? "Signing in…" : "Sign in"}
            <ArrowUpRight size={18} />
          </button>
        </form>
        <p className="private">
          <LockKeyhole size={14} /> One account. Only your money.
        </p>
      </div>
    </main>
  );
}
