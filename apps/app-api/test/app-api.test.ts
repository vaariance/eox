import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  APP_API_SCHEMA_VERSION,
  AppApiError,
  createAppApiClient,
  type AppApiClient,
  type PublicationEvent,
} from "@eox/app-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FixtureReferenceSource } from "../src/fixture-source.js";
import { createAppApiServer } from "../src/server.js";
import type { ReferenceSource } from "../src/source.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures");
const oracleFixtures = join(here, "..", "..", "..", "packages", "oracle", "fixtures");
const anchor = 1_900_000_000;

function startServer(source: ReferenceSource, now: () => number) {
  const server = createAppApiServer({ source, now, onError: (error) => { throw error; } });
  return new Promise<{ client: AppApiClient; baseUrl: string; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve({
        client: createAppApiClient({ baseUrl }),
        baseUrl,
        close: () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }),
      });
    });
  });
}

const fixtureSource = () =>
  new FixtureReferenceSource(join(fixtures, "oracle-preview.json"), join(fixtures, "timeline.json"), anchor);

let api: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => {
  api = await startServer(fixtureSource(), () => anchor);
});
afterAll(async () => {
  await api.close();
});

describe("fixture provenance", () => {
  it("was generated from the current oracle scenario files", () => {
    const preview = JSON.parse(readFileSync(join(fixtures, "oracle-preview.json"), "utf8")) as {
      scenarios: { file: string; sha256: string }[];
    };
    for (const scenario of preview.scenarios) {
      const bytes = readFileSync(join(oracleFixtures, scenario.file));
      expect(createHash("sha256").update(bytes).digest("hex"), scenario.file).toBe(scenario.sha256);
    }
  });
});

describe("references", () => {
  it("labels every response as fixture data with the schema version", async () => {
    const response = await api.client.deployment();
    expect(response.schemaVersion).toBe(APP_API_SCHEMA_VERSION);
    expect(response.deployment.origin).toBe("fixture");
    expect(response.data.origin).toBe("fixture");
  });

  it("serves the latest accepted snapshot with integer-string values from the oracle math", async () => {
    const { data, status } = await api.client.latestReference();
    expect(data.snapshot.snapshotId).toBe("fixture-snapshot-2");
    expect(data.snapshot.predecessor).toBe("fixture-snapshot-1");
    expect(data.multiplier).toBe(20);
    const us = data.countries.find((country) => country.country === "US")!;
    expect(us.reference.expressed).toBe("102249157");
    expect(us.baseline).toBe("100000000");
    expect(data.world).toEqual({ state: "100037500", confidence: "1000000", baseline: "100000000" });
    expect(status.latestSequence).toBe(2);
    expect(status.referenceAgeSeconds).toBe(660);
    expect(status.stale).toBe(false);
    expect(status.eligibleForExecution).toBe(true);
  });

  it("serves a historical snapshot and its country/WORLD reference", async () => {
    const { data } = await api.client.countryReference("US", "fixture-snapshot-1");
    expect(data.snapshot.sequence).toBe(1);
    expect(data.country.reference.expressed).toBe("100000000");
    expect(data.world.state).toBe("100000000");
  });

  it("serves country/country pairs computed by the oracle math", async () => {
    const { data } = await api.client.pair("US", "JP");
    expect(data.reference).toEqual({ ratio: "1001500", change: "1500", expressed: "103000000", confidence: "1000000" });
    expect(data.snapshot.snapshotId).toBe("fixture-snapshot-2");
  });

  it("returns explicit error codes", async () => {
    await expect(api.client.pair("US", "US")).rejects.toMatchObject({ code: "INVALID_PAIR", httpStatus: 400 });
    await expect(api.client.pair("US", "FR")).rejects.toMatchObject({ code: "INVALID_PAIR" });
    await expect(api.client.snapshot("fixture-snapshot-9")).rejects.toMatchObject({ code: "SNAPSHOT_NOT_FOUND", httpStatus: 404 });
    await expect(api.client.countryReference("FR")).rejects.toMatchObject({ code: "UNKNOWN_COUNTRY" });
    await expect(api.client.countryReference("usa")).rejects.toBeInstanceOf(AppApiError);
  });

  it("reports NO_ACCEPTED_REFERENCE and a stale status when nothing is published", async () => {
    const empty: ReferenceSource = {
      deployment: async () => ({ origin: "fixture", network: "fixture", oracleProgram: null, registry: null, fixtureSource: "empty" }),
      publications: async () => [],
      pair: async () => null,
      paused: async () => false,
      proposal: async () => null,
      readiness: async () => ({ evaluatedAt: anchor, slots: [] }),
      onPublication: () => () => {},
    };
    const local = await startServer(empty, () => anchor);
    try {
      await expect(local.client.latestReference()).rejects.toMatchObject({ code: "NO_ACCEPTED_REFERENCE", httpStatus: 404 });
      const { status } = await local.client.deployment();
      expect(status).toMatchObject({ latestSequence: null, stale: true, eligibleForExecution: false });
    } finally {
      await local.close();
    }
  });

  it("marks the reference stale after three hours without a publication", async () => {
    const local = await startServer(fixtureSource(), () => anchor + 10_800);
    try {
      const { status } = await local.client.latestReference();
      expect(status.referenceAgeSeconds).toBe(11_460);
      expect(status).toMatchObject({ stale: true, eligibleForExecution: false });
    } finally {
      await local.close();
    }
  });
});

describe("proposal and readiness", () => {
  it("shows the pending disputed proposal without replacing the accepted reference", async () => {
    const { data } = await api.client.proposal();
    expect(data).toMatchObject({ proposalId: "fixture-proposal-3", state: "precommitted", predecessor: "fixture-snapshot-2" });
    for (const assertion of data!.assertions) {
      expect(assertion.challengeDeadline - assertion.challengeStart).toBe(3600);
    }
    expect(data!.assertions.map((assertion) => assertion.state)).toEqual(["disputed", "pending"]);
    expect((await api.client.latestReference()).data.snapshot.snapshotId).toBe("fixture-snapshot-2");
  });

  it("reports readiness for every slot of the latest snapshot", async () => {
    const { data } = await api.client.evidenceReadiness();
    expect(data.slots).toHaveLength(16);
    expect(data.slots.every((slot) => slot.status === "ready")).toBe(true);
  });
});

describe("publications", () => {
  it("pages finalized publications in sequence order", async () => {
    expect((await api.client.publications(0, 1)).data).toMatchObject({ nextAfter: 1, events: [{ sequence: 1 }] });
    expect((await api.client.publications(1)).data.events.map((event) => event.sequence)).toEqual([2]);
    expect((await api.client.publications(2)).data).toEqual({ events: [], nextAfter: 2 });
  });

  it("resumes the publication stream after the last seen sequence", async () => {
    const seen: PublicationEvent[] = [];
    const subscription = api.client.subscribePublications(1, (event) => seen.push(event));
    for (let attempt = 0; attempt < 50 && seen.length === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    subscription.close();
    await subscription.closed;
    expect(seen.map((event) => event.sequence)).toEqual([2]);
  });

  it("rejects invalid paging input", async () => {
    for (const query of ["after=-1", "after=abc", "limit=0", "limit=501"]) {
      const res = await fetch(`${api.baseUrl}/v1/publications?${query}`);
      expect(res.status, query).toBe(400);
    }
  });
});

describe("other requests", () => {
  it("is read-only and rejects unknown routes", async () => {
    expect((await fetch(`${api.baseUrl}/v1/deployment`, { method: "POST" })).status).toBe(405);
    expect((await fetch(`${api.baseUrl}/v1/unknown`)).status).toBe(404);
    expect((await fetch(`${api.baseUrl}/health`)).status).toBe(200);
  });
});
