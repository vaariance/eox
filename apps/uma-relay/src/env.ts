export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function integer(name: string, fallback: bigint): bigint {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${name} must be a non-negative integer`);
  return BigInt(value);
}

export async function identityToken(audience: string): Promise<string> {
  const url = new URL("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity");
  url.searchParams.set("audience", audience);
  const response = await fetch(url, { headers: { "Metadata-Flavor": "Google" } });
  if (!response.ok) throw new Error(`identity token request failed with HTTP ${response.status}`);
  return response.text();
}

export function log(message: string): void {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`);
}

export function firstLine(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0]! : String(error);
}

export async function runEvery(seconds: bigint, name: string, tick: () => Promise<void>, onStop?: () => void): Promise<void> {
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      stopping = true;
      onStop?.();
    });
  }
  log(`${name} started`);
  while (!stopping) {
    try {
      await tick();
    } catch (error) {
      log(`tick failed: ${firstLine(error)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, Number(seconds) * 1000));
  }
  log(`${name} stopped`);
}
