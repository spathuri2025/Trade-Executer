import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";

import Dashboard from "@/pages/dashboard";
import Trades from "@/pages/trades";
import Signals from "@/pages/signals";
import Strategies from "@/pages/strategies";
import Risk from "@/pages/risk";
import Logs from "@/pages/logs";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/">
        <Layout><Dashboard /></Layout>
      </Route>
      <Route path="/trades">
        <Layout><Trades /></Layout>
      </Route>
      <Route path="/signals">
        <Layout><Signals /></Layout>
      </Route>
      <Route path="/strategies">
        <Layout><Strategies /></Layout>
      </Route>
      <Route path="/risk">
        <Layout><Risk /></Layout>
      </Route>
      <Route path="/logs">
        <Layout><Logs /></Layout>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster theme="dark" position="top-right" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
