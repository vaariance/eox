export interface Consent {
  preferences: boolean;
}

export const CONSENT_COOKIE = "relative_consent";
export const CONSENT_EVENT = "relative:consent";
export const CONSENT_OPEN_EVENT = "relative:consent-open";
const DAYS = 180;

export function readConsent(): Consent | null {
  if (typeof document === "undefined") return null;
  const entry = document.cookie.split("; ").find((part) => part.startsWith(`${CONSENT_COOKIE}=`));
  if (!entry) return null;
  try {
    const value = JSON.parse(decodeURIComponent(entry.slice(CONSENT_COOKIE.length + 1))) as Partial<Consent>;
    return { preferences: value.preferences === true };
  } catch {
    return null;
  }
}

export function writeConsent(consent: Consent): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify(consent))}; Max-Age=${DAYS * 86400}; Path=/; SameSite=Lax${secure}`;
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: consent }));
}

export function allows(kind: keyof Consent): boolean {
  return readConsent()?.[kind] === true;
}
