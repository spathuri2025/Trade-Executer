import { eq } from "drizzle-orm";
import { db, brokerCredentialsTable, type BrokerCredentialsRow } from "@workspace/db";
import { encrypt, decrypt } from "./crypto";

export interface CapitalCredentials {
  apiKey: string;
  identifier: string;
  password: string;
}

export type Trading212Environment = "live" | "demo";

export interface Trading212Credentials {
  apiKey: string;
  /** Auto-detected at connect time; older rows without it default to "live". */
  environment?: Trading212Environment;
}

export type UserBrokerCredentials =
  | { broker: "capitalcom"; capital: CapitalCredentials }
  | { broker: "trading212"; trading212: Trading212Credentials };

export type SaveBrokerCredentialsInput =
  | { broker: "capitalcom"; capital: CapitalCredentials }
  | { broker: "trading212"; trading212: Trading212Credentials };

/** Masked identifier for display — never exposes the credential itself. */
export function maskIdentifier(value: string): string {
  if (value.length <= 4) return "*".repeat(value.length);
  return `${value.slice(0, 2)}${"*".repeat(value.length - 4)}${value.slice(-2)}`;
}

export async function getUserBrokerCredentials(userId: number): Promise<UserBrokerCredentials | null> {
  const [row] = await db.select().from(brokerCredentialsTable).where(eq(brokerCredentialsTable.userId, userId));
  if (!row) return null;
  return decodeRow(row);
}

function decodeRow(row: BrokerCredentialsRow): UserBrokerCredentials | null {
  if (row.broker === "capitalcom") {
    if (!row.capitalApiKeyEnc || !row.capitalIdentifierEnc || !row.capitalPasswordEnc) return null;
    return {
      broker: "capitalcom",
      capital: {
        apiKey: decrypt(row.capitalApiKeyEnc),
        identifier: decrypt(row.capitalIdentifierEnc),
        password: decrypt(row.capitalPasswordEnc),
      },
    };
  }
  if (!row.trading212ApiKeyEnc) return null;
  return {
    broker: "trading212",
    trading212: {
      apiKey: decrypt(row.trading212ApiKeyEnc),
      environment: row.trading212Environment ?? "live",
    },
  };
}

/** Broker + masked identifier for display, or null if nothing is connected. */
export async function getUserBrokerConnectionStatus(
  userId: number,
): Promise<{ broker: "trading212" | "capitalcom"; identifierMasked: string } | null> {
  const creds = await getUserBrokerCredentials(userId);
  if (!creds) return null;
  return {
    broker: creds.broker,
    identifierMasked:
      creds.broker === "capitalcom" ? maskIdentifier(creds.capital.identifier) : maskIdentifier(creds.trading212.apiKey),
  };
}

export async function saveUserBrokerCredentials(userId: number, input: SaveBrokerCredentialsInput): Promise<void> {
  const values =
    input.broker === "capitalcom"
      ? {
          userId,
          broker: "capitalcom" as const,
          capitalApiKeyEnc: encrypt(input.capital.apiKey),
          capitalIdentifierEnc: encrypt(input.capital.identifier),
          capitalPasswordEnc: encrypt(input.capital.password),
          trading212ApiKeyEnc: null,
          trading212Environment: null,
        }
      : {
          userId,
          broker: "trading212" as const,
          capitalApiKeyEnc: null,
          capitalIdentifierEnc: null,
          capitalPasswordEnc: null,
          trading212ApiKeyEnc: encrypt(input.trading212.apiKey),
          trading212Environment: input.trading212.environment ?? "live",
        };

  await db
    .insert(brokerCredentialsTable)
    .values(values)
    .onConflictDoUpdate({
      target: brokerCredentialsTable.userId,
      set: { ...values, updatedAt: new Date() },
    });
}

export async function clearUserBrokerCredentials(userId: number): Promise<void> {
  await db.delete(brokerCredentialsTable).where(eq(brokerCredentialsTable.userId, userId));
}
