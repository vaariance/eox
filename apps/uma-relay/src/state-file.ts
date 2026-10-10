import { open, readFile, rename } from "node:fs/promises";
import { dirname } from "node:path";

import { type RelayState, emptyState } from "./relay.js";

export async function readState(path: string): Promise<RelayState> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as RelayState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    throw error;
  }
}

export async function writeState(path: string, state: RelayState): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  const file = await open(temporary, "w", 0o600);
  try {
    await file.writeFile(JSON.stringify(state));
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
  const directory = await open(dirname(path), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
