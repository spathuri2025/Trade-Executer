import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Trades from "@/pages/trades";
import Signals from "@/pages/signals";
import Scanner from "@/pages/scanner";
import Performance from "@/pages/performance";
import Instruments from "@/pages/instruments";
import Assistant from "@/pages/assistant";
import SignalAnalyst from "@/pages/signal-analyst";
import Settings from "@/pages/settings";
import Setup from "@/pages/setup";
import NotFound from "@/pages/not-found";
import { useOnboarding } from "@/hooks/use-onboarding";
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

function Router() {
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
        <Route path="/performance" component={Performance} />
        <Route path="/instruments" component={Instruments} />
        <Route path="/assistant" component={Assistant} />
        <Route path="/signal-analyst" component={SignalAnalyst} />
        <Route path="/setup" component={Setup} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
