import { useCallback, useEffect, useState } from "react";

const ADMIN_KEY = "tradebuzz_admin";
const ADMIN_EVENT = "tradebuzz_admin_change";

function readAdmin(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ADMIN_KEY) === "true";
}

/**
 * Lightweight, client-side "admin mode" gate.
 *
 * NOTE: the app has no authentication yet, so this is a localStorage flag only —
 * it controls UI visibility (e.g. the "Generate Today's Brief" button) but is NOT
 * a security boundary. Anyone can flip it. Real access control needs server-side auth.
 */
export function useAdminMode(): { isAdmin: boolean; setAdmin: (value: boolean) => void } {
  const [isAdmin, setIsAdmin] = useState<boolean>(readAdmin);

  useEffect(() => {
    const sync = () => setIsAdmin(readAdmin());
    window.addEventListener("storage", sync);
    window.addEventListener(ADMIN_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(ADMIN_EVENT, sync);
    };
  }, []);

  const setAdmin = useCallback((value: boolean) => {
    window.localStorage.setItem(ADMIN_KEY, value ? "true" : "false");
    window.dispatchEvent(new Event(ADMIN_EVENT));
    setIsAdmin(value);
  }, []);

  return { isAdmin, setAdmin };
}
