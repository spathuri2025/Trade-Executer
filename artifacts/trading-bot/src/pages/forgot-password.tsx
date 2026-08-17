import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForgotPassword } from "@workspace/api-client-react";

const muted = "hsl(var(--muted-foreground))";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const forgotPassword = useForgotPassword();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await forgotPassword.mutateAsync({ data: { email } });
    } catch {
      // Intentionally ignored. The server answers 204 whether or not the
      // address is registered, and the confirmation below is deliberately
      // identical either way — showing a different message for an unknown
      // email would tell a stranger which addresses have accounts.
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-2xl font-light">Check your email</CardTitle>
            <CardDescription>
              If an account exists for {email}, we've sent a link to reset your password. It's valid
              for one hour.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm" style={{ color: muted }}>
              Nothing arrived? Check your spam folder, or{" "}
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => setSent(false)}
                data-testid="button-forgot-retry"
              >
                try a different email address
              </button>
              .
            </p>
            <p className="text-sm mt-4 text-center" style={{ color: muted }}>
              <Link href="/login" className="text-primary hover:underline">
                Back to log in
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl font-light">Reset your password</CardTitle>
          <CardDescription>
            Enter the email address you signed up with and we'll send you a link to choose a new
            password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="input-forgot-email"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={forgotPassword.isPending}
              data-testid="button-forgot-submit"
            >
              {forgotPassword.isPending ? "Sending…" : "Send reset link"}
            </Button>
          </form>
          <p className="text-sm mt-4 text-center" style={{ color: muted }}>
            <Link href="/login" className="text-primary hover:underline">
              Back to log in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
