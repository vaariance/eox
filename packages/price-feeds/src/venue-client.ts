import { createHash } from "node:crypto";
import { decodeUtf8 } from "./json.js";

export type RestVenue = "kraken" | "coinbase" | "bybit";

export const MAX_REQUESTS_PER_SECOND: Readonly<Record<RestVenue, number>> = { kraken: 0.5, coinbase: 2, bybit: 2 };
export const BREAKER_FAILURES = 5;
export const BREAKER_OPEN_MS = 60_000;
export const CACHE_MS = 60_000;
const MAX_BACKOFF_MS = 60_000;
const BASE_BACKOFF_MS = 1_000;

export interface RawResponse {
  venue: RestVenue;
  request: string;
  status: number;
  contentType: string | null;
  body: Uint8Array;
  sha256: string;
}

export type VenueErrorKind = "unavailable" | "rate-limited" | "malformed";

export class VenueError extends Error {
  constructor(
    readonly venue: RestVenue,
    readonly kind: VenueErrorKind,
    message: string,
    readonly response: RawResponse | null = null,
  ) {
    super(`${venue}: ${message}`);
    this.name = "VenueError";
  }
}

export interface VenueMetrics {
  requests: number;
  rateLimited: number;
  failures: number;
  backoffMs: number;
  cacheHits: number;
  breakerOpenUntil: number;
}

export interface VenueClientOptions {
  requestsPerSecond: number;
  userAgent: string;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  timeoutMs?: number;
}

function rateLimited(venue: RestVenue, status: number, body: Uint8Array): boolean {
  if (status === 429) return true;
  let text: string;
  try {
    text = decodeUtf8(body);
  } catch {
    return false;
  }
  if (venue === "kraken") return text.includes("EAPI:Rate limit exceeded") || text.includes("EAPI:Too many requests");
  if (venue === "bybit") return /"retCode"\s*:\s*(10006|10018)\b/.test(text);
  return false;
}

function retryAfterMs(header: string | null, now: number): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

export class VenueClient {
  readonly metrics: VenueMetrics = { requests: 0, rateLimited: 0, failures: 0, backoffMs: 0, cacheHits: 0, breakerOpenUntil: 0 };
  private readonly intervalMs: number;
  private readonly doFetch: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly timeoutMs: number;
  private readonly cache = new Map<string, { at: number; response: RawResponse }>();
  private queue: Promise<unknown> = Promise.resolve();
  private nextAt = 0;
  private consecutiveFailures = 0;

  constructor(
    readonly venue: RestVenue,
    private readonly options: VenueClientOptions,
  ) {
    const max = MAX_REQUESTS_PER_SECOND[venue];
    if (!(options.requestsPerSecond > 0) || options.requestsPerSecond > max) {
      throw new Error(`${venue} budget ${options.requestsPerSecond}/s is outside (0, ${max}]`);
    }
    if (!options.userAgent.trim()) throw new Error("a User-Agent naming COX and a contact is required");
    this.intervalMs = 1000 / options.requestsPerSecond;
    this.doFetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  get breakerOpen(): boolean {
    return this.metrics.breakerOpenUntil > this.now();
  }

  get(url: string, deadline: number): Promise<RawResponse> {
    const run = this.queue.then(() => this.send(url, deadline));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async send(url: string, deadline: number): Promise<RawResponse> {
    for (const [key, entry] of this.cache) if (this.now() - entry.at >= CACHE_MS) this.cache.delete(key);
    const cached = this.cache.get(url);
    if (cached) {
      this.metrics.cacheHits += 1;
      return cached.response;
    }
    for (;;) {
      if (this.breakerOpen) throw new VenueError(this.venue, "unavailable", "circuit breaker open");
      const wait = this.nextAt - this.now();
      if (wait > 0) {
        if (this.now() + wait > deadline) throw new VenueError(this.venue, "rate-limited", "budget exhausted before the deadline");
        await this.sleep(wait);
      }
      this.nextAt = this.now() + this.intervalMs;
      this.metrics.requests += 1;
      let res: Response;
      let body: Uint8Array;
      try {
        res = await this.doFetch(url, {
          headers: { accept: "application/json", "user-agent": this.options.userAgent },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        body = new Uint8Array(await res.arrayBuffer());
      } catch (error) {
        this.fail();
        throw new VenueError(this.venue, "unavailable", `request failed: ${(error as Error).message}`);
      }
      const response: RawResponse = {
        venue: this.venue,
        request: `GET ${url}`,
        status: res.status,
        contentType: res.headers.get("content-type"),
        body,
        sha256: createHash("sha256").update(body).digest("hex"),
      };
      if (rateLimited(this.venue, res.status, body)) {
        this.metrics.rateLimited += 1;
        this.fail();
        const backoff = retryAfterMs(res.headers.get("retry-after"), this.now())
          ?? Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (this.consecutiveFailures - 1)) * (0.5 + this.random() / 2);
        if (this.now() + backoff > deadline) throw new VenueError(this.venue, "rate-limited", "rate limited past the deadline", response);
        this.metrics.backoffMs += backoff;
        this.nextAt = Math.max(this.nextAt, this.now() + backoff);
        continue;
      }
      if (res.status >= 500) {
        this.fail();
        throw new VenueError(this.venue, "unavailable", `HTTP ${res.status}`, response);
      }
      this.consecutiveFailures = 0;
      if (res.status === 200) this.cache.set(url, { at: this.now(), response });
      return response;
    }
  }

  private fail(): void {
    this.metrics.failures += 1;
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= BREAKER_FAILURES) {
      this.metrics.breakerOpenUntil = this.now() + BREAKER_OPEN_MS;
      this.consecutiveFailures = 0;
    }
  }
}
