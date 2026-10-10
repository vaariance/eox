import { isDecimal } from "../decimal.js";
import { parseLossless } from "../json.js";

export const KRAKEN_WS_URL = "wss://ws.kraken.com/v2";
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
const RETAIN_SECONDS = 2 * 60 * 60;

export interface WsCandle {
  start: number;
  close: string;
  trades: string;
  frames: string[];
}

export type WsCandleStatus =
  | { status: "trades"; candle: WsCandle }
  | { status: "empty" }
  | { status: "unknown"; reason: string };

export interface SocketLike {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface KrakenWsOptions {
  symbols: readonly string[];
  url?: string;
  connect?: (url: string) => SocketLike;
  now?: () => number;
  random?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  onError?: (error: unknown) => void;
}

interface Coverage {
  from: number;
  to: number;
}

function minuteOf(iso: unknown): number | null {
  if (typeof iso !== "string") return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms) || ms % 60_000 !== 0) return null;
  return ms / 1000;
}

export class KrakenWsFeed {
  readonly metrics = { connections: 0, disconnects: 0, frames: 0, malformedFrames: 0 };
  private readonly symbols: Set<string>;
  private readonly candles = new Map<string, Map<number, WsCandle>>();
  private readonly subscribed = new Set<string>();
  private readonly coverage = new Map<string, Coverage[]>();
  private socket: SocketLike | null = null;
  private stopped = false;
  private attempt = 0;
  private lastFrameAt = 0;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;

  constructor(private readonly options: KrakenWsOptions) {
    this.symbols = new Set(options.symbols);
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  }

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.socket?.close();
    this.socket = null;
  }

  candle(symbol: string, start: number): WsCandleStatus {
    if (!this.symbols.has(symbol)) throw new Error(`symbol ${symbol} is not subscribed`);
    const stored = this.candles.get(symbol)?.get(start);
    if (!this.covered(symbol, start, start + 60)) return { status: "unknown", reason: "the connection did not cover the whole minute" };
    if (stored && stored.trades !== "0") return { status: "trades", candle: stored };
    return { status: "empty" };
  }

  lastTradeBefore(symbol: string, before: number): WsCandle | null {
    const series = this.candles.get(symbol);
    if (!series) return null;
    const starts = [...series.keys()].filter((start) => start < before && series.get(start)!.trades !== "0").sort((a, b) => b - a);
    const latest = starts[0];
    if (latest === undefined) return null;
    return this.covered(symbol, latest + 60, before) ? series.get(latest)! : null;
  }

  private covered(symbol: string, from: number, to: number): boolean {
    if (this.lastFrameAt / 1000 < to) return false;
    return (this.coverage.get(symbol) ?? []).some((c) => c.from <= from && c.to >= to);
  }

  private open(): void {
    const connect = this.options.connect ?? ((url) => new WebSocket(url) as unknown as SocketLike);
    const socket = connect(this.options.url ?? KRAKEN_WS_URL);
    this.socket = socket;
    socket.onopen = () => {
      this.metrics.connections += 1;
      socket.send(JSON.stringify({ method: "subscribe", params: { channel: "ohlc", symbol: [...this.symbols], interval: 1, snapshot: true } }));
    };
    socket.onmessage = (event) => this.receive(typeof event.data === "string" ? event.data : String(event.data));
    socket.onerror = (error) => this.options.onError?.(error);
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.metrics.disconnects += 1;
      this.subscribed.clear();
      if (this.stopped) return;
      const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** this.attempt) * (0.5 + this.random() / 2);
      this.attempt += 1;
      this.schedule(() => {
        if (!this.stopped) this.open();
      }, delay);
    };
  }

  private receive(text: string): void {
    const at = this.now();
    this.metrics.frames += 1;
    let message: { method?: unknown; success?: unknown; result?: { symbol?: unknown }; channel?: unknown; data?: unknown };
    try {
      message = parseLossless(text) as typeof message;
    } catch {
      this.metrics.malformedFrames += 1;
      return;
    }
    this.lastFrameAt = at;
    const nowSeconds = Math.floor(at / 1000);
    for (const symbol of this.subscribed) {
      const spans = this.coverage.get(symbol)!;
      spans[spans.length - 1]!.to = nowSeconds;
    }
    if (message.method === "subscribe" && message.success === true && typeof message.result?.symbol === "string") {
      const symbol = message.result.symbol;
      if (this.symbols.has(symbol) && !this.subscribed.has(symbol)) {
        this.subscribed.add(symbol);
        this.attempt = 0;
        const spans = this.coverage.get(symbol) ?? [];
        spans.push({ from: nowSeconds, to: nowSeconds });
        this.coverage.set(symbol, spans);
      }
      return;
    }
    if (message.channel !== "ohlc" || !Array.isArray(message.data)) return;
    for (const entry of message.data as Record<string, unknown>[]) {
      const symbol = entry.symbol;
      const start = minuteOf(entry.interval_begin);
      if (typeof symbol !== "string" || !this.symbols.has(symbol) || start === null) {
        this.metrics.malformedFrames += 1;
        continue;
      }
      if (typeof entry.close !== "string" || !isDecimal(entry.close) || typeof entry.trades !== "string" || !/^\d+$/.test(entry.trades)) {
        this.metrics.malformedFrames += 1;
        continue;
      }
      const series = this.candles.get(symbol) ?? new Map<number, WsCandle>();
      this.candles.set(symbol, series);
      const existing = series.get(start);
      series.set(start, { start, close: entry.close, trades: entry.trades, frames: [...(existing?.frames ?? []), text] });
    }
    this.prune(nowSeconds);
  }

  private prune(nowSeconds: number): void {
    const oldest = nowSeconds - RETAIN_SECONDS;
    for (const series of this.candles.values()) for (const start of series.keys()) if (start < oldest) series.delete(start);
    for (const [symbol, spans] of this.coverage) this.coverage.set(symbol, spans.filter((span, i) => span.to >= oldest || i === spans.length - 1));
  }
}
