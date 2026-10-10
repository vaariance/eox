import { writeFileSync } from "node:fs";
import { buildCoxFixture } from "./cox-fixture-build.ts";

const target = new URL("../fixtures/cox-fixture.json", import.meta.url);
writeFileSync(target, `${JSON.stringify(buildCoxFixture(), null, 2)}\n`);
console.log(`wrote ${target.pathname}`);
