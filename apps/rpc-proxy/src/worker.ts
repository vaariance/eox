export interface Env {
  UPSTREAM_URLS: string;
  ACCESS_TOKENS: string;
}

export const ALLOWED_METHODS = new Set([
  "getAccountInfo",
  "getBalance",
  "getBlockHeight",
  "getEpochInfo",
  "getFeeForMessage",
  "getGenesisHash",
  "getHealth",
  "getLatestBlockhash",
  "getMinimumBalanceForRentExemption",
  "getMultipleAccounts",
  "getProgramAccounts",
  "getRecentPrioritizationFees",
  "getSignatureStatuses",
  "getSignaturesForAddress",
  "getSlot",
  "getTokenAccountBalance",
  "getTransaction",
  "getVersion",
  "isBlockhashValid",
  "sendTransaction",
  "simulateTransaction",
]);

const MAX_BODY_BYTES = 65_536;
const MAX_BATCH = 20;
const UPSTREAM_TIMEOUT_MS = 15_000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

function rpcError(status: number, code: number, message: string): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code, message } }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

const list = (value: string | undefined): string[] => (value ?? "").split(/\s+/).filter(Boolean);

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function authorized(presented: string, tokens: readonly string[]): Promise<boolean> {
  const wanted = await digest(presented);
  let match = false;
  for (const token of tokens) {
    const candidate = await digest(token);
    let difference = 0;
    for (let i = 0; i < candidate.length; i += 1) difference |= candidate[i]! ^ wanted[i]!;
    match = match || difference === 0;
  }
  return match;
}

function permitted(body: unknown): boolean {
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > MAX_BATCH) return false;
  return calls.every((call) => {
    if (call === null || typeof call !== "object" || Array.isArray(call)) return false;
    const { jsonrpc, method } = call as { jsonrpc?: unknown; method?: unknown };
    return jsonrpc === "2.0" && typeof method === "string" && ALLOWED_METHODS.has(method);
  });
}

export async function handle(request: Request, env: Env, upstreamFetch: typeof fetch = fetch): Promise<Response> {
  const tokens = list(env.ACCESS_TOKENS).filter((t) => TOKEN_PATTERN.test(t));
  const upstreams = list(env.UPSTREAM_URLS).filter((u) => u.startsWith("https://"));
  if (tokens.length === 0 || upstreams.length === 0) return rpcError(503, -32000, "proxy is not configured");
  const path = new URL(request.url).pathname.split("/").filter(Boolean);
  if (path.length !== 1 || !TOKEN_PATTERN.test(path[0]!) || !(await authorized(path[0]!, tokens))) return rpcError(401, -32001, "unauthorized");
  if (request.method !== "POST") return rpcError(405, -32600, "only POST is accepted");
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return rpcError(415, -32600, "content-type must be application/json");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return rpcError(413, -32600, "request too large");
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BODY_BYTES) return rpcError(413, -32600, "request too large");
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return rpcError(400, -32700, "parse error");
  }
  if (!permitted(body)) return rpcError(403, -32601, "method not permitted");
  for (let index = 0; index < upstreams.length; index += 1) {
    try {
      const response = await upstreamFetch(upstreams[index]!, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: bytes,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (response.status === 429 || response.status >= 500) {
        console.warn(JSON.stringify({ event: "upstream-failed", upstream: index, status: response.status }));
        continue;
      }
      return new Response(response.body, {
        status: response.status,
        headers: { "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "no-store", "x-rpc-upstream": String(index) },
      });
    } catch (error) {
      console.warn(JSON.stringify({ event: "upstream-failed", upstream: index, error: error instanceof Error ? error.name : "unknown" }));
    }
  }
  return rpcError(502, -32002, "every upstream failed");
}

export default { fetch: (request: Request, env: Env) => handle(request, env) };
