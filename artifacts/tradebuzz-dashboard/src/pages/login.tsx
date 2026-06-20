import { useState } from "react";

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        onSuccess();
      } else {
        setError("Incorrect password");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="dark min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-7">
        <div className="flex items-center gap-2 justify-center">
          <div className="w-2 h-2 rounded-full bg-primary" />
          <span className="font-semibold text-lg tracking-wide text-white">
            TradeBuzz
          </span>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="password"
            className="text-[10px] uppercase tracking-widest text-white/40"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white outline-none focus:border-primary transition-colors"
            placeholder="Enter password"
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={loading || !password}
          className="w-full rounded bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>

        <p className="text-center text-[10px] uppercase tracking-widest text-white/25">
          &copy; {new Date().getFullYear()} ClinAITech Limited
        </p>
      </form>
    </div>
  );
}
