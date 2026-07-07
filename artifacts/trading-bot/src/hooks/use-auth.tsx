import { createContext, useContext, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMe,
  getGetMeQueryKey,
  useSignup,
  useLogin,
  useLogout,
  type AuthUser,
} from "@workspace/api-client-react";

interface AuthContextValue {
  user: AuthUser | undefined;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  signup: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const meQueryKey = getGetMeQueryKey();

  // A 401 here just means "not logged in" — not an error worth retrying or surfacing.
  const { data: user, isLoading } = useGetMe({
    query: { queryKey: meQueryKey, retry: false },
  });

  const loginMutation = useLogin();
  const signupMutation = useSignup();
  const logoutMutation = useLogout();

  const value: AuthContextValue = {
    user,
    isLoading,
    login: async (email, password) => {
      const result = await loginMutation.mutateAsync({ data: { email, password } });
      await queryClient.invalidateQueries({ queryKey: meQueryKey });
      return result;
    },
    signup: async (email, password) => {
      const result = await signupMutation.mutateAsync({ data: { email, password } });
      await queryClient.invalidateQueries({ queryKey: meQueryKey });
      return result;
    },
    logout: async () => {
      try {
        await logoutMutation.mutateAsync();
      } finally {
        // Clear client-side state unconditionally — even if the network call
        // failed, the user should never get stuck unable to log out.
        // (setQueryData(key, undefined) is a documented no-op in React Query;
        // removeQueries is what actually clears the cached user immediately.)
        queryClient.removeQueries({ queryKey: meQueryKey });
      }
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
