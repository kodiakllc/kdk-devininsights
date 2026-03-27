import * as crypto from "crypto";

/**
 * Utility functions for anonymizing user data before telemetry transmission.
 */
export function hashValue(value: string, salt: string = "kdk-devinsights"): string {
  return crypto.createHash("sha256").update(`${salt}:${value}`).digest("hex").substring(0, 16);
}

export function anonymizeEmail(email: string): string {
  return hashValue(email);
}

export function anonymizeUsername(username: string): string {
  return hashValue(username);
}

export function anonymizeFilePath(filePath: string): string {
  // Keep the file extension and directory depth, but hash the actual names
  const parts = filePath.split("/");
  const fileName = parts[parts.length - 1];
  const ext = fileName.includes(".") ? "." + fileName.split(".").pop() : "";
  return `${"*/".repeat(Math.max(0, parts.length - 1))}${hashValue(fileName).substring(0, 8)}${ext}`;
}

/**
 * Generate a deterministic but anonymous machine ID.
 */
export function generateAnonymousMachineId(rawId: string): string {
  return hashValue(rawId, "machine");
}

/**
 * Generate a UUID v4.
 */
export function generateId(): string {
  return crypto.randomUUID();
}
