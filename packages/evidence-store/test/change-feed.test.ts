import { afterAll, describe, expect, it } from "vitest";
import {
  getObservation,
  getSourcePayload,
  pool,
  readChanges,
  recordObservation,
  recordSourcePayload,
  type ChangeCursor,
} from "../src/index.js";

afterAll(async () => {
  await pool.end();
});

const base = {
  countryIso3: "NOR",
  indicatorId: "policy_rate",
  sourceId: "bis",
  vintage: "change-feed-test",
};

let monthCounter = 0;
function nextPeriod() {
  monthCounter += 1;
  const month = String(monthCounter).padStart(2, "0");
  return { periodStart: `2020-${month}-01`, periodEnd: `2020-${month}-28` };
}

async function drain(after: ChangeCursor | null): Promise<{ ids: string[]; cursor: ChangeCursor | null }> {
  const ids: string[] = [];
  let cursor = after;
  for (;;) {
    const page = await readChanges(cursor, 2);
    ids.push(...page.observations.map((observation) => observation.id));
    if (page.observations.length === 0) return { ids, cursor };
    cursor = page.cursor;
  }
}

describe("readChanges", () => {
  it("pages through every committed observation once, in commit-safe order", async () => {
    const start = await drain(null);
    const inserted = [];
    for (let index = 0; index < 5; index++) {
      inserted.push((await recordObservation({ ...base, ...nextPeriod(), value: String(index) })).id);
    }
    const next = await drain(start.cursor);
    expect(next.ids).toEqual(inserted);
    expect((await drain(next.cursor)).ids).toEqual([]);
  });

  it("does not skip a row whose transaction commits after a later one", async () => {
    const { cursor } = await drain(null);
    const slow = await pool.connect();
    try {
      await slow.query("BEGIN");
      const slowInsert = await slow.query(
        `INSERT INTO observations (country_iso3, indicator_id, period_start, period_end, value, source_id, vintage)
         VALUES ('NOR', 'policy_rate', '2019-01-01', '2019-01-31', 1, 'bis', 'change-feed-slow')
         RETURNING id::text`,
      );
      const fast = await recordObservation({ ...base, ...nextPeriod(), value: "2" });

      const whileOpen = await drain(cursor);
      expect(whileOpen.ids).not.toContain(fast.id);

      await slow.query("COMMIT");
      const afterCommit = await drain(whileOpen.cursor);
      expect(afterCommit.ids).toEqual([slowInsert.rows[0].id, fast.id]);
    } finally {
      slow.release();
    }
  });

  it("ignores an inserted_xid supplied by the caller", async () => {
    const { rows } = await pool.query(
      `INSERT INTO observations (country_iso3, indicator_id, period_start, period_end, value, source_id, vintage, inserted_xid)
       VALUES ('NOR', 'policy_rate', '2018-01-01', '2018-01-31', 1, 'bis', 'change-feed-forged', '1'::xid8)
       RETURNING inserted_xid::text AS xid, pg_current_xact_id()::text AS current`,
    );
    expect(rows[0].xid).toBe(rows[0].current);
  });

  it("rejects an invalid page size", async () => {
    await expect(readChanges(null, 0)).rejects.toThrow(/invalid change page limit/);
  });
});

describe("record and payload reads", () => {
  it("reads one observation by id and returns null for an unknown id", async () => {
    const stored = await recordObservation({ ...base, ...nextPeriod(), value: "3.5" });
    expect((await getObservation(stored.id))?.value).toBe("3.500000");
    expect(await getObservation("999999999")).toBeNull();
  });

  it("returns the exact payload bytes for a digest", async () => {
    const body = new TextEncoder().encode(`payload-${Date.now()}`);
    const stored = await recordSourcePayload({
      sourceId: "bis",
      requestUrl: "https://example.test/payload",
      httpStatus: 200,
      contentType: "text/csv",
      body,
    });
    const read = await getSourcePayload(stored.sha256);
    expect(read?.contentType).toBe("text/csv");
    expect(Buffer.compare(read!.body, Buffer.from(body))).toBe(0);
    expect(await getSourcePayload("0".repeat(64))).toBeNull();
  });
});
