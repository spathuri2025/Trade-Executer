import { useEffect, useState } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Trades from "@/pages/trades";
import Signals from "@/pages/signals";
import Scanner from "@/pages/scanner";
import Instruments from "@/pages/instruments";
import Settings from "@/pages/settings";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/trades" component={Trades} />
        <Route path="/signals" component={Signals} />
        <Route path="/scanner" component={Scanner} />
        <Route path="/instruments" component={Instruments} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { authenticated: false }))
      .then((d) => {
        if (active) setAuthed(Boolean(d?.authenticated));
      })
      .catch(() => {
        if (active) setAuthed(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (authed === null) {
    return (
      <div className="dark min-h-screen bg-background flex items-center justify-center text-white/50 text-sm">
        Loading…
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {authed ? (
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        ) : (
          <Login onSuccess={() => setAuthed(true)} />
        )}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
