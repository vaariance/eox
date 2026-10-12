import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Inline = { kind: "text" | "bold"; text: string } | { kind: "link"; text: string; href: string };
export type Block = { kind: "title" | "heading" | "paragraph"; parts: Inline[] } | { kind: "table"; head: Inline[][]; rows: Inline[][][] };

const ROUTES: Record<string, string> = { "relative-terms.md": "/terms", "relative-privacy.md": "/privacy" };
const TOKEN = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;

function inline(text: string): Inline[] {
  const parts: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    if (match.index > last) parts.push({ kind: "text", text: text.slice(last, match.index) });
    if (match[1] !== undefined) {
      parts.push({ kind: "bold", text: match[1] });
    } else {
      const target = match[3];
      const href = /^(https?:|mailto:|\/)/.test(target) ? target : ROUTES[target];
      parts.push(href ? { kind: "link", text: match[2], href } : { kind: "text", text: match[2] });
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

export function legalDocument(name: string): Block[] {
  const source = readFileSync(join(process.cwd(), "content", "legal", `${name}.md`), "utf8");
  return source
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk): Block => {
      if (chunk.startsWith("|")) {
        const lines = chunk.split("\n").map(cells);
        return { kind: "table", head: lines[0].map(inline), rows: lines.slice(2).map((line) => line.map(inline)) };
      }
      if (chunk.startsWith("## ")) return { kind: "heading" as const, parts: inline(chunk.slice(3)) };
      if (chunk.startsWith("# ")) return { kind: "title" as const, parts: inline(chunk.slice(2)) };
      return { kind: "paragraph" as const, parts: inline(chunk.replace(/\n/g, " ")) };
    });
}
