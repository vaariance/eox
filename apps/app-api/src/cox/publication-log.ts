import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, truncateSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import type { Publication } from "@eox/app-api";

const SCHEMA = "cox.app-api.publications/v1";

interface Header {
  schema: typeof SCHEMA;
  program: string;
  pool: string;
}

export class PublicationLog {
  private readonly entries: Publication[] = [];

  constructor(
    private readonly path: string,
    private readonly identity: { program: string; pool: string },
  ) {
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) {
      this.write(`${JSON.stringify({ schema: SCHEMA, ...identity } satisfies Header)}\n`);
      return;
    }
    const text = readFileSync(path, "utf8");
    const complete = text.endsWith("\n") ? text : text.slice(0, text.lastIndexOf("\n") + 1);
    if (complete.length !== text.length) truncateSync(path, Buffer.byteLength(complete));
    const [first, ...lines] = complete.split("\n").filter((line) => line.length > 0);
    const header = first === undefined ? null : (JSON.parse(first) as Header);
    if (!header || header.schema !== SCHEMA || header.program !== identity.program || header.pool !== identity.pool) {
      throw new Error(`publication log ${path} belongs to another program or pool`);
    }
    for (const line of lines) this.accept(JSON.parse(line) as Publication);
  }

  get all(): readonly Publication[] {
    return this.entries;
  }

  get nextSequence(): number {
    return this.entries.length;
  }

  append(publication: Publication): void {
    this.accept(publication);
    this.write(`${JSON.stringify(publication)}\n`);
  }

  private accept(publication: Publication): void {
    const previous = this.entries.at(-1);
    if (publication.identity.sequence !== this.entries.length) throw new Error(`publication ${publication.identity.sequence} is out of order`);
    if (previous && publication.identity.predecessorBatch !== previous.identity.batch) throw new Error(`publication ${publication.identity.sequence} does not follow batch ${previous.identity.batch}`);
    this.entries.push(publication);
  }

  private write(text: string): void {
    const fd = openSync(this.path, "a");
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
}
