import { OAuth2Client } from "google-auth-library";

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export type CallerVerifier = (authorization: string | undefined) => Promise<string | null>;

export function googleIdTokenVerifier(audience: string, knownCallers: ReadonlySet<string>): CallerVerifier {
  const client = new OAuth2Client();
  return async (authorization) => {
    if (!audience || !authorization?.startsWith("Bearer ")) return null;
    try {
      const ticket = await client.verifyIdToken({ idToken: authorization.slice(7), audience });
      const payload = ticket.getPayload();
      if (!payload?.email || payload.email_verified !== true) return null;
      if (!payload.iss || !GOOGLE_ISSUERS.includes(payload.iss)) return null;
      return knownCallers.has(payload.email) ? payload.email : null;
    } catch {
      return null;
    }
  };
}
