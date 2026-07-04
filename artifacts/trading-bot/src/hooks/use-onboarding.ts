import { useCallback, useEffect, useState } from "react";

const ONBOARDED_KEY = "tradebuzz_onboarded";
const ONBOARDED_EVENT = "tradebuzz_onboarded_change";

function readOnboarded(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(ONBOARDED_KEY) === "true";
}

/**
 * Client-side "has the user completed the setup wizard?" flag.
 *
 * Used only to decide whether to nudge a first-run user into the guided setup
 * flow. It is a localStorage flag, not a security boundary — every individual
 * page (Instruments, Scanner, Settings) stays fully accessible regardless.
 */
export function useOnboarding(): { onboarded: boolean; setOnboarded: (value: boolean) => void } {
  const [onboarded, setOnboardedState] = useState<boolean>(readOnboarded);

  useEffect(() => {
    const sync = () => setOnboardedState(readOnboarded());
    window.addEventListener("storage", sync);
    window.addEventListener(ONBOARDED_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(ONBOARDED_EVENT, sync);
    };
  }, []);

  const setOnboarded = useCallback((value: boolean) => {
    window.localStorage.setItem(ONBOARDED_KEY, value ? "true" : "false");
    window.dispatchEvent(new Event(ONBOARDED_EVENT));
    setOnboardedState(value);
  }, []);

  return { onboarded, setOnboarded };
}
