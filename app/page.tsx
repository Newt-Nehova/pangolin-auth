"use client";

/**
 * The whole app is this one static page. Screens are chosen by the URL hash
 * (#add, #settings, #edit:<id>) rather than by routes, because the unlocked
 * key lives only in this page's memory: a real navigation would lock the vault.
 * Hash changes are history entries, so the phone's back gesture still works.
 */
import { useCallback, useEffect, useState } from "react";
import { AddFlow } from "@/components/AddFlow";
import { EditEntry } from "@/components/EditEntry";
import { Export } from "@/components/Export";
import { Lock, Setup } from "@/components/Gate";
import { Home } from "@/components/Home";
import { Mark } from "@/components/Mark";
import { Settings } from "@/components/Settings";
import { useVault } from "@/lib/vault";

function useHashRoute() {
  const [route, setRoute] = useState("");
  useEffect(() => {
    const read = () => setRoute(decodeURIComponent(window.location.hash.slice(1)));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const go = useCallback((next: string) => {
    window.location.hash = next;
  }, []);
  const home = useCallback(() => {
    // Prefer stepping back so the history doesn't fill with screens; fall back
    // to clearing the hash when the page was opened straight onto a screen.
    if (window.history.length > 1 && window.location.hash) window.history.back();
    else window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setRoute("");
  }, []);
  return { route, go, home };
}

export default function App() {
  const vault = useVault();
  const { route, go, home } = useHashRoute();

  // Locking or erasing must not leave the user on a screen they can no longer
  // use -- nor reopen it straight after they unlock or start a new vault.
  useEffect(() => {
    if ((vault.status === "locked" || vault.status === "new") && route) home();
  }, [vault.status, route, home]);

  switch (vault.status) {
    case "loading":
      return (
        <div className="flex min-h-dvh items-center justify-center text-accent" aria-label="Loading">
          <Mark size={56} className="animate-pulse" />
        </div>
      );
    case "unsupported":
      return (
        <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 text-center">
          <h1 className="text-xl font-semibold">This browser can&apos;t run the vault</h1>
          <p className="mt-2 text-muted">
            It needs a secure connection (https) and on-device storage. Private browsing modes sometimes switch storage off.
          </p>
        </div>
      );
    case "new":
      return <Setup />;
    case "locked":
      return <Lock />;
  }

  if (route === "add") return <AddFlow back={home} done={home} />;
  if (route === "settings") return <Settings back={home} />;
  if (route === "export") return <Export back={home} />;
  if (route.startsWith("edit:")) return <EditEntry key={route} id={route.slice(5)} back={home} />;
  return <Home go={go} />;
}
