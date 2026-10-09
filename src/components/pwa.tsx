"use client";
import { useEffect, useState } from "react";
export function ViewportBridge() {
  useEffect(() => {
    const viewport = window.visualViewport;
    function update() {
      if (!viewport || viewport.scale !== 1) return;
      document.documentElement.style.setProperty(
        "--app-height",
        viewport.height + "px",
      );
      document.documentElement.style.setProperty(
        "--app-top",
        viewport.offsetTop + "px",
      );
    }
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
    };
  }, []);
  return null;
}
export function PwaStatus() {
  const [offline, setOffline] = useState(false),
    [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    let alive = true;
    const online = () => setOffline(!navigator.onLine);
    online();
    window.addEventListener("online", online);
    window.addEventListener("offline", online);
    let reloading = false;
    const controlled = () => {
      if (!reloading) {
        reloading = true;
        window.location.reload();
      }
    };
    navigator.serviceWorker?.addEventListener("controllerchange", controlled);
    navigator.serviceWorker
      ?.register("/sw.js")
      .then((reg) => {
        if (!alive) return;
        if (reg.waiting) setWaiting(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          worker?.addEventListener("statechange", () => {
            if (
              alive &&
              worker.state === "installed" &&
              navigator.serviceWorker.controller
            )
              setWaiting(worker);
          });
        });
        void reg.update().catch(() => {});
      })
      .catch(() => {
        if (alive) setOffline(!navigator.onLine);
      });
    return () => {
      alive = false;
      window.removeEventListener("online", online);
      window.removeEventListener("offline", online);
      navigator.serviceWorker?.removeEventListener(
        "controllerchange",
        controlled,
      );
    };
  }, []);
  return (
    <>
      {offline && (
        <div className="system-banner" role="status">
          Offline · Viewing loaded data. Connect to save changes.
        </div>
      )}
      {waiting && (
        <div className="system-banner">
          Update ready. Save your work first.
          <button onClick={() => waiting.postMessage({ type: "SKIP_WAITING" })}>
            Refresh
          </button>
        </div>
      )}
    </>
  );
}
