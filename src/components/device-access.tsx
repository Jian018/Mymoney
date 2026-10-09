"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Copy,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { browserClient } from "@/lib/supabase/browser";
import { PwaStatus, ViewportBridge } from "./pwa";

export default function DeviceAccess({ configured }: { configured: boolean }) {
  const [deviceId, setDeviceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const working = useRef(false);

  const checkAccess = useCallback(async () => {
    const response = await fetch("/api/device", {
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Unable to check device access.");
    setDeviceId(result.deviceId);
    if (result.authorized) {
      window.location.replace("/");
      return;
    }
    setMessage(
      result.ownerConfigured
        ? "This device is waiting for your approval in Supabase."
        : "Authorize this device in Supabase, then set ALLOWED_USER_ID in Vercel and redeploy.",
    );
  }, []);

  useEffect(() => {
    if (!configured) return;
    let alive = true;
    async function resume() {
      try {
        const { data, error: authError } = await browserClient().auth.getUser();
        if (authError && authError.name !== "AuthSessionMissingError")
          throw authError;
        if (!alive || !data.user) return;
        setDeviceId(data.user.id);
        await checkAccess();
      } catch (e) {
        if (alive)
          setError(
            e instanceof Error
              ? e.message
              : "Unable to resume this device. Try again.",
          );
      }
    }
    void resume();
    return () => {
      alive = false;
    };
  }, [configured, checkAccess]);

  async function connect() {
    if (working.current || !configured) return;
    working.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (!navigator.onLine)
        throw new Error("Connect to the internet before binding your device.");
      const db = browserClient();
      const existing = await db.auth.getUser();
      if (existing.error && existing.error.name !== "AuthSessionMissingError")
        throw existing.error;
      let user = existing.data.user;
      if (!user) {
        const created = await db.auth.signInAnonymously();
        if (created.error)
          throw new Error(
            "Device setup failed: " +
              created.error.message +
              ". Enable Anonymous Sign-Ins in Supabase and check the sign-up settings.",
          );
        user = created.data.user;
      }
      if (!user)
        throw new Error("No device session was created. Please retry.");
      setDeviceId(user.id);
      await checkAccess();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Unable to bind this device. Retry when connected.",
      );
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="shell device-access">
      <ViewportBridge />
      <PwaStatus />
      <div className="device-scroll">
        <div className="brandmark">
          <ArrowUpRight size={38} />
        </div>
        <p className="eyebrow">MY MONEY</p>
        <h1>
          Your money.
          <br />
          Your own space.
        </h1>
        <p className="muted">
          No email. No password.
          <br />
          Approve this device once, then open your app directly.
        </p>
        <div className="card device-card">
          <span className="device-badge">
            <Smartphone size={26} />
          </span>
          <h2>
            {deviceId
              ? "One last step: approve this device."
              : "A private space on your iPhone."}
          </h2>
          {!configured && (
            <p className="alert">
              Setup required: add the Supabase URL and publishable key in
              Vercel, then redeploy.
            </p>
          )}
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          {deviceId && (
            <>
              <label>
                Device ID
                <input value={deviceId} readOnly aria-label="Device ID" />
              </label>
              <button
                className="secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(deviceId);
                    setMessage("Device ID copied.");
                  } catch {
                    setError("Select and copy the Device ID manually.");
                  }
                }}
              >
                <Copy size={17} /> Copy device ID
              </button>
              <p className="muted small">
                Use this ID with supabase/setup-device.sql to approve access to
                your private ledger. Only you can approve devices from your
                Supabase dashboard.
              </p>
            </>
          )}
          {message && (
            <p className="success-note" role="status">
              {message}
            </p>
          )}
          <button
            className="primary"
            disabled={!configured || busy}
            onClick={() => void connect()}
          >
            {busy
              ? "Checking your device…"
              : deviceId
                ? "I’ve approved this device · Check access"
                : "Bind this device"}
            {deviceId ? <RefreshCw size={17} /> : <ShieldCheck size={18} />}
          </button>
        </div>
        <p className="device-note">
          Install on your iPhone Home Screen before binding. Each browser or
          installation has its own session. Clearing its data requires approving
          a new session; your ledger stays in Supabase.
        </p>
      </div>
    </main>
  );
}
