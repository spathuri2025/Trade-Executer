import { useState } from "react";
import { useLocation } from "wouter";
import { useLogin, useAuthStatus } from "@/lib/engineApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Lock, Activity } from "lucide-react";
import { toast } from "sonner";

export default function Login() {
  const [password, setPassword] = useState("");
  const login = useLogin();
  const [, setLocation] = useLocation();
  const { data: auth } = useAuthStatus();

  // If already authenticated, redirect
  if (auth?.authenticated) {
    setLocation("/");
    return null;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    
    login.mutate({ password }, {
      onSuccess: () => {
        toast.success("Authentication successful");
        setLocation("/");
      },
      onError: (err) => {
        toast.error("Authentication failed", { description: err.message });
      }
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background dark text-foreground p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
            <Activity className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">TradeBuzz</h1>
          <p className="text-muted-foreground mt-2 font-mono text-sm">SECURE TERMINAL ACCESS</p>
        </div>

        <div className="bg-card border border-border rounded-lg p-6 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="password">Operator Passphrase</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 font-mono bg-background"
                  placeholder="••••••••••••"
                  autoFocus
                />
              </div>
            </div>
            
            <Button 
              type="submit" 
              className="w-full font-bold tracking-widest" 
              disabled={login.isPending || !password}
            >
              {login.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : "INITIALIZE SESSION"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
