type Reviver = (this: unknown, key: string, value: unknown, context?: { source?: string }) => unknown;

const keepNumberSource: Reviver = (_key, value, context) => {
  if (typeof value !== "number") return value;
  if (context?.source === undefined) throw new Error("this runtime cannot read JSON number source text");
  return context.source;
};

export function parseLossless(text: string): unknown {
  return JSON.parse(text, keepNumberSource as Parameters<typeof JSON.parse>[1]);
}

export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
