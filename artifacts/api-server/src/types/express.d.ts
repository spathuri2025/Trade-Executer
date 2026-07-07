import type { User } from "@workspace/db";

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth middleware; only present on routes mounted after it. */
      user?: Pick<User, "id" | "email">;
    }
  }
}

export {};
