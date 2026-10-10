import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const recorded = join(dirname(fileURLToPath(import.meta.url)), "recorded");

export function recordedText(name: string): string {
  return readFileSync(join(recorded, name), "utf8");
}

export interface FakeReply {
  status?: number;
  body: string;
  headers?: Record<string, string>;
}

export class FakeHttp {
  readonly calls: string[] = [];
  private readonly routes: { match: RegExp; replies: FakeReply[] }[] = [];

  on(match: RegExp, ...replies: FakeReply[]): this {
    this.routes.push({ match, replies });
    return this;
  }

  readonly fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    this.calls.push(url);
    const route = this.routes.find((r) => r.match.test(url));
    if (!route) throw new Error(`no fake route for ${url}`);
    const reply = route.replies.length > 1 ? route.replies.shift()! : route.replies[0]!;
    return new Response(reply.body, { status: reply.status ?? 200, headers: { "content-type": "application/json", ...reply.headers } });
  }) as typeof fetch;
}

export class FakeClock {
  constructor(public ms: number) {}
  readonly now = () => this.ms;
  readonly sleeps: number[] = [];
  readonly sleep = async (ms: number) => {
    this.sleeps.push(ms);
    this.ms += ms;
  };
}

export const UA = "COX-test (ops@example.test)";
