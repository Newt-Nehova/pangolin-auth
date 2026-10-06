"use client";

import { useEffect, useState } from "react";

/**
 * Registers the offline worker (production only) and offers updates.
 *
 * In development a worker caching pages is actively harmful: it serves
 * yesterday's build while you are trying to look at today's edit.
 *
 * Updates are offered, not forced. A new worker waits until every tab on the
 * old one has gone -- and a single tab that is only ever reloaded never goes,
 * because the reload starts before the old page lets go. So the page watches
 * for a waiting worker and asks; tapping activates it and reloads.
 */
export default function ServiceWorker() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    let reloading = false;
    // On a first visit the worker taking control is not an update: there is
    // no old build to replace, and reloading would wipe a half-typed passcode.
    const hadController = !!navigator.serviceWorker.controller;
    const onControllerChange = () => {
      if (reloading || !hadController) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        if (registration.waiting && navigator.serviceWorker.controller) setWaiting(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const incoming = registration.installing;
          incoming?.addEventListener("statechange", () => {
            if (incoming.state === "installed" && navigator.serviceWorker.controller) setWaiting(incoming);
          });
        });
      })
      .catch(() => {
        // Offline support is an enhancement; the app works without it.
      });

    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  if (!waiting) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-3 top-3 z-[60] mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-bg shadow-lg"
    >
      <p className="min-w-0 flex-1 text-sm">An update is ready. You&apos;ll need to unlock again after it.</p>
      <button
        onClick={() => {
          setUpdating(true);
          waiting.postMessage("SKIP_WAITING");
        }}
        disabled={updating}
        className="h-11 shrink-0 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-60"
      >
        {updating ? "Updating…" : "Update"}
      </button>
    </div>
  );
}
