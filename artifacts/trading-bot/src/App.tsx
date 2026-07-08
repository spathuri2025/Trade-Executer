import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/spinner";
import { Layout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Trades from "@/pages/trades";
import Signals from "@/pages/signals";
import Scanner from "@/pages/scanner";
import MarketNews from "@/pages/market-news";
import Performance from "@/pages/performance";
import Instruments from "@/pages/instruments";
import Charts from "@/pages/charts";
import Assistant from "@/pages/assistant";
import SignalAnalyst from "@/pages/signal-analyst";
import Settings from "@/pages/settings";
import Admin from "@/pages/admin";
import Setup from "@/pages/setup";
import Login from "@/pages/login";
import Signup from "@/pages/signup";
import NotFound from "@/pages/not-found";
import { useOnboarding } from "@/hooks/use-onboarding";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { useLocation, Redirect } from "wouter";
import { useListInstruments, getListInstrumentsQueryKey } from "@workspace/api-client-react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Keep the dashboard feeling live: refetch when the user returns to the
      // tab/window, and don't serve stale cache without revalidating.
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      staleTime: 0,
      retry: 1,
    },
  },
});

/** Rendered once a session is confirmed — everything here assumes an authenticated user. */
function ProtectedRouter() {
  const { onboarded } = useOnboarding();
  const [location] = useLocation();
  const { data: instruments, isLoading: instrumentsLoading } = useListInstruments({
    query: { queryKey: getListInstrumentsQueryKey() },
  });

  // Only nudge a genuinely fresh install into the guided setup: the onboarded
  // flag is unset AND there are no instruments yet. Existing users (who already
  // have instruments, or cleared their localStorage) are never force-redirected.
  const isFreshInstall = !onboarded && !instrumentsLoading && (instruments?.length ?? 0) === 0;
  if (isFreshInstall && location !== "/setup") {
    return <Redirect to="/setup" />;
  }

  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/trades" component={Trades} />
        <Route path="/signals" component={Signals} />
        <Route path="/scanner" component={Scanner} />
        <Route path="/market-news" component={MarketNews} />
        <Route path="/performance" component={Performance} />
        <Route path="/instruments" component={Instruments} />
        <Route path="/charts" component={Charts} />
        <Route path="/assistant" component={Assistant} />
        <Route path="/signal-analyst" component={SignalAnalyst} />
        <Route path="/setup" component={Setup} />
        <Route path="/settings" component={Settings} />
        <Route path="/admin" component={Admin} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

/**
 * Gates the whole app behind a session: shows the public login/signup pages
 * for anyone not logged in, and only mounts ProtectedRouter (which fires
 * real API queries) once a session is confirmed.
 */
function AppShell() {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (!user) {
    if (location === "/signup") return <Signup />;
    if (location !== "/login") return <Redirect to="/login" />;
    return <Login />;
  }

  if (location === "/login" || location === "/signup") {
    return <Redirect to="/" />;
  }

  return <ProtectedRouter />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AppShell />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
