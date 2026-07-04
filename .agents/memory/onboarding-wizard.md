---
name: TradeBuzz onboarding / first-run redirect
description: Safety + UX rules for the setup wizard's config write and first-run auto-redirect
---

# Setup wizard (`/setup`) rules

- **Setup completion must pin `dryRun: true`** in the `updateBotConfig` payload. Spreading `...botStatus.config` would inherit a live `dryRun=false` from a prior config and start real trading on "Start Engine". Always override it explicitly.
  **Why:** brief-level safety constraint — setup starts the engine in paper mode only.

- **First-run auto-redirect must not trap existing users.** `useOnboarding` treats a missing `tradebuzz_onboarded` localStorage key as NOT onboarded, so redirecting on `!onboarded` alone force-sends legacy users (or anyone who cleared storage / uses a new browser) into the wizard. Gate the redirect on a genuine fresh install: `!onboarded && !instrumentsLoading && instruments.length === 0`.
  **How to apply:** any first-run/onboarding gate driven by localStorage should combine the flag with a server-state heuristic (here: zero instruments) before forcing navigation.

- `minTrendStrength` lives on **ScannerConfig**, not BotConfig — the wizard writes it via `updateScannerConfig`, everything else via `updateBotConfig`.
