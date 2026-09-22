# EOX Evidence Store — Implementation Guide

**Owner:** Joel
**Package:** `packages/evidence-store`
**Goal:** Store every economic number EOX receives, forever, without ever overwriting it, so we can always answer *"what did we know on date X?"*

This guide takes you from an empty folder to a working, tested evidence store. Follow the steps in order. Every step ends with a check so you know it worked before moving on.

---

## Contents

0. [What you are building](#0-what-you-are-building)
1. [Install the tools](#1-install-the-tools)
2. [Create the monorepo](#2-create-the-monorepo)
3. [Start Postgres](#3-start-postgres)
4. [Create your package](#4-create-your-package)
5. [Write the database schema](#5-write-the-database-schema)
6. [Write the migration runner](#6-write-the-migration-runner)
7. [Connect to the database](#7-connect-to-the-database)
8. [Define the types](#8-define-the-types)
9. [Write the store functions](#9-write-the-store-functions)
10. [Export the public API](#10-export-the-public-api)
11. [Write and run the demo](#11-write-and-run-the-demo)
12. [Prove the rules hold](#12-prove-the-rules-hold)
13. [Commit and push](#13-commit-and-push)
14. [Tell Peter and Godwin how to use it](#14-tell-peter-and-godwin-how-to-use-it)
15. [What comes next](#15-what-comes-next)
16. [Troubleshooting](#16-troubleshooting)

---

## 0. What you are building

```
Peter (ingestion)  ──recordObservation()──▶  YOU (evidence-store)  ──getAsOf()──▶  Godwin (methodology)
```

Your package is the pantry in the middle. It has one table that matters, `observations`, and one rule that matters:

> **Rows are only ever added. Never edited. Never deleted.**

Every row has two clocks:

| Clock | Column | Meaning |
|---|---|---|
| 1 | `period_start` / `period_end` | What slice of time the number describes (e.g. Jan–Mar 2025) |
| 2 | `known_at` | When EOX learned the number |

Because nothing is overwritten, you can ask the table two different questions:

- **"What did we believe on 15 June?"** → look only at rows with `known_at` before 15 June, take the newest.
- **"What do we believe now?"** → take the newest row, full stop.

**v0.1 scope:** official statistics only (GDP, core CPI, unemployment, policy rate, fiscal deficit) for Nigeria, USA, China, India.

---

## 1. Install the tools

You need four things. Check each one:

```bash
node -v        # need v20 or higher
pnpm -v        # need v9 or higher
docker -v      # any recent version
git --version
```

If something is missing:

- **Node:** install from nodejs.org (LTS).
- **pnpm:** `npm install -g pnpm` (or `corepack enable`).
- **Docker:** install Docker Desktop and make sure it's running.

✅ **Check:** all four commands print a version number.

---

## 2. Create the monorepo

> **If Peter has already created the repo**, skip to the end of this step: clone it, create your branch, and go to Step 3. Don't create a second repo.

### 2.1 Make the folder and start git

```bash
mkdir eox && cd eox
git init
```

### 2.2 Create the folder structure

```bash
mkdir -p apps docs
mkdir -p packages/ingestion packages/methodology
mkdir -p packages/evidence-store/migrations packages/evidence-store/src packages/evidence-store/scripts
```

What each folder is for:

| Folder | Owner | Purpose |
|---|---|---|
| `packages/ingestion` | Peter | Fetch data from sources |
| `packages/evidence-store` | Joel | Store facts forever |
| `packages/methodology` | Godwin | Turn facts into scores |
| `apps/` | later | API, web app |
| `docs/` | everyone | Guides like this one |

### 2.3 Root `package.json`

Create `package.json` in the repo root:

```json
{
  "name": "eox",
  "private": true,
  "scripts": {
    "db:up": "docker compose up -d",
    "db:down": "docker compose down",
    "db:migrate": "pnpm --filter @eox/evidence-store migrate",
    "demo": "pnpm --filter @eox/evidence-store demo"
  }
}
```

These scripts let anyone run your package's commands from the root of the repo.

### 2.4 Tell pnpm where the packages live

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

This is what makes it a monorepo: pnpm treats every folder under `apps/` and `packages/` as its own package, and they can import each other.

### 2.5 `.gitignore` and `.env.example`

`.gitignore`:

```
node_modules
dist
.env
```

`.env.example`:

```
DATABASE_URL=postgres://eox:eox@localhost:5432/eox
```

### 2.6 Placeholder READMEs for Peter and Godwin

`packages/ingestion/README.md`:

```markdown
# @eox/ingestion (Peter)

Fetches data from sources (APIs, downloads) and hands clean rows
to `@eox/evidence-store` via `recordObservation()`.

Contract: ingestion never writes to the database directly.
It always goes through the evidence-store functions.
```

`packages/methodology/README.md`:

```markdown
# @eox/methodology (Godwin)

Reads observations from `@eox/evidence-store` (using `getAsOf`)
and turns them into scores: weighting, normalization, ranking.

Contract: methodology never changes stored numbers.
It only reads them and computes from them.
```

### 2.7 Create your working branch

```bash
git add .
git commit -m "chore: monorepo skeleton"
git checkout -b feature/evidence-store
```

✅ **Check:** `git branch` shows `* feature/evidence-store`.

---

## 3. Start Postgres

We run Postgres in Docker so everyone on the team gets the exact same database.

Create `docker-compose.yml` in the repo root:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: eox
      POSTGRES_PASSWORD: eox
      POSTGRES_DB: eox
    ports:
      - "5432:5432"
    volumes:
      - eox-pgdata:/var/lib/postgresql/data

volumes:
  eox-pgdata:
```

Start it:

```bash
pnpm db:up
```

✅ **Check:**

```bash
docker ps
```

You should see a `postgres:16` container with status `Up`.

---

## 4. Create your package

### 4.1 `packages/evidence-store/package.json`

```json
{
  "name": "@eox/evidence-store",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "migrate": "tsx src/migrate.ts",
    "demo": "tsx scripts/demo.ts",
    "build": "tsc"
  },
  "dependencies": {
    "pg": "^8.12.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/pg": "^8.11.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0"
  }
}
```

- `pg` is the Postgres driver.
- `tsx` runs TypeScript directly without a build step.
- We deliberately **don't use an ORM** (Prisma, TypeORM). We need database triggers and a special query (`DISTINCT ON`) that ORMs make awkward. Plain SQL keeps it simple and visible.

### 4.2 `packages/evidence-store/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src", "scripts"]
}
```

### 4.3 Install

From the **repo root**:

```bash
pnpm install
```

✅ **Check:** a `node_modules` folder appears and there are no errors.

---

## 5. Write the database schema

This is the most important file in your package. Create `packages/evidence-store/migrations/001_init.sql`.

It has four tables:

| Table | What it holds |
|---|---|
| `sources` | Who published a number (e.g. Nigeria's NBS) |
| `indicators` | What is being measured (e.g. GDP growth) |
| `recipes` | How a number was made, if we calculated it ourselves (for satellite data later) |
| `observations` | **The actual numbers.** Append-only. |

```sql
-- EOX evidence store, v0.1
-- Scope: official statistics only (Dimension E), 4 prototype countries.
-- Core rule: observations are APPEND-ONLY. Never updated, never deleted.

-- Where a number came from.
CREATE TABLE sources (
  id               TEXT PRIMARY KEY,          -- e.g. 'nbs-ng'
  name             TEXT NOT NULL,
  country_iso3     CHAR(3),                   -- NULL for international sources (IMF, World Bank)
  provenance_class TEXT NOT NULL CHECK (provenance_class IN
                     ('official', 'official_adjacent', 'licensed_commercial', 'derived')),
  redistributable  BOOLEAN NOT NULL DEFAULT false,  -- can we republish raw values?
  url              TEXT
);

-- What is being measured.
CREATE TABLE indicators (
  id        TEXT PRIMARY KEY,                 -- e.g. 'gdp_real_growth_yoy'
  name      TEXT NOT NULL,
  unit      TEXT NOT NULL,                    -- e.g. 'percent'
  dimension TEXT NOT NULL                     -- 'A'..'E' from Peter's list
);

-- How a number was produced, when it was not published directly
-- (e.g. satellite reductions later). Unused for official stats in v0.1.
CREATE TABLE recipes (
  id          SERIAL PRIMARY KEY,
  description JSONB NOT NULL,                 -- border file, cloud rule, method, etc.
  code_hash   TEXT NOT NULL,                  -- git commit / hash of the code that ran
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The facts. One row per (thing, period, version we learned).
CREATE TABLE observations (
  id                BIGSERIAL PRIMARY KEY,
  country_iso3      CHAR(3) NOT NULL CHECK (country_iso3 ~ '^[A-Z]{3}$'),
  indicator_id      TEXT NOT NULL REFERENCES indicators(id),

  -- Clock 1: what slice of time the number describes
  period_start      DATE NOT NULL,
  period_end        DATE NOT NULL,

  -- NUMERIC, not float: exact decimals, same result on every machine
  value             NUMERIC(20, 6) NOT NULL,

  source_id         TEXT NOT NULL REFERENCES sources(id),
  vintage           TEXT NOT NULL,            -- 'first', 'second', 'final', 'rebased'...
  published_at      TIMESTAMPTZ NOT NULL,     -- when the source released it

  -- Clock 2: when EOX learned it
  known_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  recipe_id         INT REFERENCES recipes(id),
  raw_sha256        TEXT,                     -- fingerprint of the raw file we read

  -- Our own mistakes: fixed by a NEW row pointing at the bad one
  supersedes_id     BIGINT REFERENCES observations(id),
  correction_reason TEXT,

  CHECK (period_end >= period_start),
  CHECK ((supersedes_id IS NULL) = (correction_reason IS NULL)),
  UNIQUE (country_iso3, indicator_id, period_start, period_end, source_id, known_at)
);

CREATE INDEX observations_lookup
  ON observations (country_iso3, indicator_id, period_start, known_at DESC);

-- Enforce append-only at the database level, so no code path can cheat.
CREATE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'observations are append-only: % is not allowed. Insert a correction row instead.', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER observations_no_update_delete
  BEFORE UPDATE OR DELETE ON observations
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER observations_no_truncate
  BEFORE TRUNCATE ON observations
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- Seed: Dimension E indicators
INSERT INTO indicators (id, name, unit, dimension) VALUES
  ('gdp_real_growth_yoy', 'Real GDP growth, year on year', 'percent', 'E'),
  ('cpi_core_yoy',        'Core CPI inflation, year on year', 'percent', 'E'),
  ('unemployment_rate',   'Unemployment rate', 'percent', 'E'),
  ('policy_rate',         'Central bank policy rate', 'percent', 'E'),
  ('fiscal_deficit_gdp',  'Fiscal deficit, share of GDP', 'percent', 'E');

-- Seed: sources for the 4 prototype countries (extend as Peter confirms them)
INSERT INTO sources (id, name, country_iso3, provenance_class, redistributable, url) VALUES
  ('nbs-ng',  'National Bureau of Statistics (Nigeria)', 'NGA', 'official', true, 'https://nigerianstat.gov.ng'),
  ('cbn-ng',  'Central Bank of Nigeria',                 'NGA', 'official', true, 'https://www.cbn.gov.ng'),
  ('bea-us',  'Bureau of Economic Analysis (US)',        'USA', 'official', true, 'https://www.bea.gov'),
  ('bls-us',  'Bureau of Labor Statistics (US)',         'USA', 'official', true, 'https://www.bls.gov'),
  ('fed-us',  'US Federal Reserve',                      'USA', 'official', true, 'https://www.federalreserve.gov'),
  ('nbs-cn',  'National Bureau of Statistics of China',  'CHN', 'official', true, 'https://www.stats.gov.cn'),
  ('pboc-cn', 'People''s Bank of China',                 'CHN', 'official', true, 'http://www.pbc.gov.cn'),
  ('mospi-in','Ministry of Statistics (India)',          'IND', 'official', true, 'https://mospi.gov.in'),
  ('rbi-in',  'Reserve Bank of India',                   'IND', 'official', true, 'https://www.rbi.org.in'),
  ('imf',     'International Monetary Fund',             NULL,  'official', true, 'https://data.imf.org');
```

### Why each important line is there

| Line | Why |
|---|---|
| `value NUMERIC(20, 6)` | Floats give slightly different answers on different machines. NUMERIC is exact. Reproducibility depends on this. |
| `known_at ... DEFAULT now()` | Clock 2. Live data gets stamped automatically with the moment it arrived. |
| `vintage` | Which release this was: first estimate, second, final, rebased. |
| `supersedes_id` + `correction_reason` | How we fix our own mistakes without erasing them. The `CHECK` forces both to be filled in together: you can't correct something without saying why. |
| `UNIQUE (...)` | Stops the same fact being stored twice by accident. |
| `redistributable` | Some data is licensed and can't be republished. We track that per source from day one. |
| The two triggers | The database itself refuses UPDATE, DELETE and TRUNCATE. Even buggy code can't rewrite history. |

> **Rule for the future:** once a migration file has been run and committed, **never edit it**. Make a new file, `002_something.sql`, instead.

---

## 6. Write the migration runner

A small script that runs every `.sql` file in `migrations/` once, in order, and remembers which ones it already ran.

Create `packages/evidence-store/src/migrate.ts`:

```ts
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

// Tiny migration runner: applies migrations/*.sql in name order, once each.
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);

const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
for (const file of files) {
  const done = await pool.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
  if (done.rowCount) continue;
  const sql = await readFile(join(dir, file), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    await client.query("COMMIT");
    console.log(`applied ${file}`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
console.log("migrations up to date");
await pool.end();
```

Each file runs inside a transaction (`BEGIN` … `COMMIT`). If anything in the file fails, nothing from it is applied.

(Don't run it yet — it needs `db.ts` from the next step.)

---

## 7. Connect to the database

Create `packages/evidence-store/src/db.ts`:

```ts
import pg from "pg";

// Postgres returns NUMERIC as a string by default. We keep it that way on purpose:
// converting to a JS number would introduce float rounding and break reproducibility.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://eox:eox@localhost:5432/eox",
});
```

Now run the migration from the repo root:

```bash
pnpm db:migrate
```

✅ **Check:** you see

```
applied 001_init.sql
migrations up to date
```

Run it a second time. You should only see `migrations up to date`. That proves it doesn't re-apply files.

---

## 8. Define the types

Create `packages/evidence-store/src/types.ts`:

```ts
/** A value as an exact decimal string, e.g. "3.200000". Never a JS float. */
export type Decimal = string;

export interface NewObservation {
  countryIso3: string;       // "NGA"
  indicatorId: string;       // "gdp_real_growth_yoy"
  periodStart: string;       // "2025-01-01"
  periodEnd: string;         // "2025-03-31"
  value: Decimal | number;   // numbers are converted to strings before storage
  sourceId: string;          // "nbs-ng"
  vintage: string;           // "first" | "second" | "final" | ...
  publishedAt: string;       // ISO timestamp from the source
  /** When EOX learned it. Leave empty for live data (defaults to now).
   *  Only set it when backfilling history. */
  knownAt?: string;
  recipeId?: number;
  rawSha256?: string;
}

export interface Observation {
  id: string;
  countryIso3: string;
  indicatorId: string;
  periodStart: string;
  periodEnd: string;
  value: Decimal;
  sourceId: string;
  vintage: string;
  publishedAt: Date;
  knownAt: Date;
  recipeId: number | null;
  rawSha256: string | null;
  supersedesId: string | null;
  correctionReason: string | null;
}

export interface Query {
  countryIso3: string;
  indicatorId: string;
  sourceId?: string;
}
```

`NewObservation` is what Peter sends you. `Observation` is what Godwin gets back.

---

## 9. Write the store functions

These five functions are the only way anyone touches the data.

| Function | Question it answers |
|---|---|
| `recordObservation()` | Save a new number |
| `recordCorrection()` | Fix one of *our* mistakes |
| `getAsOf(date)` | What did we believe on this date? |
| `getLatest()` | What do we believe now? |
| `getHistory()` | Every version ever saved for one period |

Create `packages/evidence-store/src/store.ts`:

```ts
import { pool } from "./db.js";
import type { NewObservation, Observation, Query } from "./types.js";

const COLUMNS = `
  id::text, country_iso3 AS "countryIso3", indicator_id AS "indicatorId",
  to_char(period_start, 'YYYY-MM-DD') AS "periodStart",
  to_char(period_end,   'YYYY-MM-DD') AS "periodEnd",
  value::text AS value, source_id AS "sourceId", vintage,
  published_at AS "publishedAt", known_at AS "knownAt",
  recipe_id AS "recipeId", raw_sha256 AS "rawSha256",
  supersedes_id::text AS "supersedesId", correction_reason AS "correctionReason"`;

/** Add a new fact. This is the ONLY way data enters the store. */
export async function recordObservation(o: NewObservation): Promise<Observation> {
  return insert(o, null, null);
}

/** Fix one of OUR mistakes (e.g. a parsing bug). The bad row stays forever;
 *  the new row points at it and says why. */
export async function recordCorrection(
  badObservationId: string,
  fixed: NewObservation,
  reason: string,
): Promise<Observation> {
  if (!reason.trim()) throw new Error("A correction needs a reason.");
  return insert(fixed, badObservationId, reason);
}

async function insert(
  o: NewObservation,
  supersedesId: string | null,
  reason: string | null,
): Promise<Observation> {
  const { rows } = await pool.query(
    `INSERT INTO observations
       (country_iso3, indicator_id, period_start, period_end, value, source_id,
        vintage, published_at, known_at, recipe_id, raw_sha256,
        supersedes_id, correction_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9::timestamptz, now()), $10,$11,$12,$13)
     RETURNING ${COLUMNS}`,
    [
      o.countryIso3, o.indicatorId, o.periodStart, o.periodEnd, String(o.value),
      o.sourceId, o.vintage, o.publishedAt, o.knownAt ?? null,
      o.recipeId ?? null, o.rawSha256 ?? null, supersedesId, reason,
    ],
  );
  return rows[0];
}

/** "What did EOX believe at this moment?"
 *  Returns one row per period (per source): the newest version known at `asOf`. */
export async function getAsOf(q: Query, asOf: Date | string): Promise<Observation[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (period_start, period_end, source_id) ${COLUMNS}
       FROM observations
      WHERE country_iso3 = $1
        AND indicator_id = $2
        AND ($3::text IS NULL OR source_id = $3)
        AND known_at <= $4
      ORDER BY period_start, period_end, source_id, known_at DESC, observations.id DESC`,
    [q.countryIso3, q.indicatorId, q.sourceId ?? null, asOf],
  );
  return rows;
}

/** "What do we believe now?" Same question, asked today. */
export async function getLatest(q: Query): Promise<Observation[]> {
  return getAsOf(q, new Date());
}

/** Every version ever recorded for one period, oldest first. */
export async function getHistory(q: Query, periodStart: string): Promise<Observation[]> {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS}
       FROM observations
      WHERE country_iso3 = $1 AND indicator_id = $2
        AND ($3::text IS NULL OR source_id = $3)
        AND period_start = $4
      ORDER BY known_at, observations.id`,
    [q.countryIso3, q.indicatorId, q.sourceId ?? null, periodStart],
  );
  return rows;
}
```

### How `getAsOf` works, in plain words

1. `WHERE known_at <= $4` — throw away everything we learned *after* the date you asked about. Pretend we're back in time.
2. `ORDER BY ... known_at DESC` — for each period, put the newest remaining version first.
3. `DISTINCT ON (period_start, period_end, source_id)` — keep only that first row per period.

Result: exactly what EOX believed on that date. `getLatest` is the same thing with the date set to "now".

### Why `$1, $2, ...` instead of putting values into the string

Those are **parameters**. The driver sends values separately from the SQL, so a weird value can never break or hijack the query (SQL injection). Always use them.

---

## 10. Export the public API

Create `packages/evidence-store/src/index.ts`:

```ts
export * from "./types.js";
export { recordObservation, recordCorrection, getAsOf, getLatest, getHistory } from "./store.js";
export { pool } from "./db.js";
```

This is the front door. Peter and Godwin import from `@eox/evidence-store` only, never from internal files.

---

## 11. Write and run the demo

The demo plays out one real-world situation: Nigeria's GDP for Q1 2025 gets revised three times after first release. (Values are **made up** for the demo.)

Create `packages/evidence-store/scripts/demo.ts`:

```ts
// The Nigeria GDP story: one quarter, four different answers over time.
// Values are MADE UP for the demo. Run: pnpm demo
import { recordObservation, getAsOf, getLatest, getHistory, pool } from "../src/index.js";

const q = { countryIso3: "NGA", indicatorId: "gdp_real_growth_yoy", sourceId: "nbs-ng" };
const period = { periodStart: "2025-01-01", periodEnd: "2025-03-31" };

const releases = [
  { value: "3.2", vintage: "first",   date: "2025-05-30T10:00:00Z" },
  { value: "2.9", vintage: "second",  date: "2025-06-30T10:00:00Z" },
  { value: "3.1", vintage: "third",   date: "2025-08-29T10:00:00Z" },
  { value: "2.7", vintage: "rebased", date: "2026-02-14T10:00:00Z" },
];

// Only insert once, so the demo can be re-run (we can't delete, by design).
if ((await getHistory(q, period.periodStart)).length === 0) {
  for (const r of releases) {
    await recordObservation({
      ...q, ...period, value: r.value, vintage: r.vintage,
      publishedAt: r.date, knownAt: r.date, // backfill: we "learned" it on release day
    });
  }
}

const show = (label: string, rows: { value: string; vintage: string }[]) =>
  console.log(label.padEnd(38), rows.map((r) => `${Number(r.value)}% (${r.vintage})`).join(", "));

console.log("\nNigeria real GDP growth, Q1 2025\n");
show("What we believed on 15 Jun 2025:", await getAsOf(q, "2025-06-15"));
show("What we believed on 1 Sep 2025:",  await getAsOf(q, "2025-09-01"));
show("What we believe today:",           await getLatest(q));

console.log("\nEvery version ever recorded:");
for (const r of await getHistory(q, period.periodStart)) {
  console.log(`  ${r.knownAt.toISOString().slice(0, 10)}  ${Number(r.value)}%  (${r.vintage})`);
}

console.log("\nTrying to overwrite history with UPDATE...");
try {
  await pool.query("UPDATE observations SET value = 99 WHERE country_iso3 = 'NGA'");
  console.log("  !! update succeeded, this should never happen");
} catch (e) {
  console.log("  blocked:", (e as Error).message);
}

await pool.end();
```

Run it from the repo root:

```bash
pnpm demo
```

✅ **Check:** you should see exactly this:

```
Nigeria real GDP growth, Q1 2025

What we believed on 15 Jun 2025:       3.2% (first)
What we believed on 1 Sep 2025:        3.1% (third)
What we believe today:                 2.7% (rebased)

Every version ever recorded:
  2025-05-30  3.2%  (first)
  2025-06-30  2.9%  (second)
  2025-08-29  3.1%  (third)
  2026-02-14  2.7%  (rebased)

Trying to overwrite history with UPDATE...
  blocked: observations are append-only: UPDATE is not allowed. Insert a correction row instead.
```

Read the first three lines carefully. Same table, same quarter, three different correct answers depending on *when* you ask. That's the whole job.

Also run the type checker:

```bash
cd packages/evidence-store && npx tsc --noEmit && cd ../..
```

✅ **Check:** no output means no type errors.

---

## 12. Prove the rules hold

Open a database shell:

```bash
docker compose exec postgres psql -U eox -d eox
```

Try each of these. **Every one should fail** — that's the point.

```sql
-- 1. Editing a value
UPDATE observations SET value = 5 WHERE id = 1;
-- expect: ERROR: observations are append-only: UPDATE is not allowed...

-- 2. Deleting a row
DELETE FROM observations WHERE id = 1;
-- expect: ERROR: observations are append-only: DELETE is not allowed...

-- 3. Wiping the table
TRUNCATE observations;
-- expect: ERROR: observations are append-only: TRUNCATE is not allowed...

-- 4. A correction with no reason
INSERT INTO observations (country_iso3, indicator_id, period_start, period_end,
  value, source_id, vintage, published_at, supersedes_id)
VALUES ('NGA','gdp_real_growth_yoy','2025-01-01','2025-03-31',
  3.0,'nbs-ng','fix','2025-05-30', 1);
-- expect: ERROR: new row ... violates check constraint

-- 5. A bad country code
INSERT INTO observations (country_iso3, indicator_id, period_start, period_end,
  value, source_id, vintage, published_at)
VALUES ('ng','gdp_real_growth_yoy','2025-01-01','2025-03-31',
  3.0,'nbs-ng','first','2025-05-30');
-- expect: ERROR: ... violates check constraint
```

Type `\q` to leave.

✅ **Check:** all five fail with an error.

---

## 13. Commit and push

Add a root `README.md` (short: what the repo is, who owns what, how to run it), then:

```bash
git add .
git commit -m "feat(evidence-store): append-only bitemporal observation store v0.1"
git push -u origin feature/evidence-store
```

Open a pull request and ask Peter to review. In the PR description, paste the demo output from Step 11. It explains the design better than any paragraph.

---

## 14. Tell Peter and Godwin how to use it

Send them this.

**Peter — saving data:**

```ts
import { recordObservation } from "@eox/evidence-store";

await recordObservation({
  countryIso3: "NGA",
  indicatorId: "cpi_core_yoy",
  periodStart: "2026-08-01",
  periodEnd: "2026-08-31",
  value: "22.15",                         // send as a string if you can
  sourceId: "nbs-ng",
  vintage: "first",
  publishedAt: "2026-09-15T10:00:00Z",   // when NBS released it
  // knownAt: leave empty for live data
});
```

Rules for Peter:

- Always go through `recordObservation()`. Never write SQL against the table.
- Leave `knownAt` empty for live data. Only set it when loading old history, and set it to the real release date.
- If a source publishes a revision, just record it as a new observation with a new `vintage`. Don't try to "update" anything.
- If a new source or indicator is needed, tell Joel. It gets added through a new migration file.

**Godwin — reading data:**

```ts
import { getAsOf, getLatest } from "@eox/evidence-store";

// What did we know at the end of the epoch?
const rows = await getAsOf(
  { countryIso3: "NGA", indicatorId: "gdp_real_growth_yoy" },
  "2026-12-31T23:59:59Z",
);

// What do we know now?
const latest = await getLatest({ countryIso3: "NGA", indicatorId: "cpi_core_yoy" });
```

Rules for Godwin:

- `value` is a **string** on purpose. Use a decimal library (e.g. `decimal.js`) for maths, not `Number()`, so results are identical on every machine.
- For anything that affects scores or settlement, use `getAsOf` with a fixed date, not `getLatest`. Otherwise the answer changes every time new data arrives.

---

## 15. What comes next

Not for today. In rough order:

1. **Load real data.** Once Peter confirms sources, backfill real history for the 4 countries × 5 indicators. Use the real release dates for `knownAt`.
2. **Automated tests.** Turn Step 12 into tests (`node:test` or `vitest`) so the rules are checked on every pull request.
3. **"New data arrived" event.** When a row is inserted, notify Godwin's code so it recalculates scores. Start simple with Postgres `LISTEN/NOTIFY`.
4. **Snapshots.** Save each calculated score together with a hash of the exact rows and methodology version that produced it, so anyone can verify it.
5. **Public export.** Write redistributable observations to Parquet files so outsiders can reproduce EOX numbers themselves.
6. **Satellite data (if the team adds it).** Use the `recipes` table to record how each number was calculated.

### Open questions for the team

- Which settlement rule do we use for revised data: first release, value after a fixed window, or a designated final vintage? Your store supports all three; the team has to pick one per market.
- Who is allowed to set `knownAt` manually? Right now anyone calling `recordObservation` can. Later we should restrict it to backfill scripts.
- When two sources report the same thing (e.g. NBS and IMF both report Nigeria GDP), which wins? That's a methodology decision for Godwin. Your store keeps both.

---

## 16. Troubleshooting

| Problem | Fix |
|---|---|
| `port 5432 is already allocated` | Another Postgres is running. Stop it, or change the left side of `"5432:5432"` to `"5433:5432"` and set `DATABASE_URL=postgres://eox:eox@localhost:5433/eox`. |
| `ECONNREFUSED 127.0.0.1:5432` | Postgres isn't running. `pnpm db:up`, wait a few seconds, try again. |
| `pnpm: command not found` | `npm install -g pnpm` |
| `relation "observations" does not exist` | You haven't migrated. `pnpm db:migrate`. |
| You edited `001_init.sql` after running it and want a clean start (**local only**) | `pnpm db:down && docker volume rm eox_eox-pgdata && pnpm db:up && pnpm db:migrate`. Never do this on a shared or production database. |
| Demo shows nothing | Check `DATABASE_URL`; you may be pointed at a different database. |
