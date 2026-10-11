import assert from "node:assert/strict";
import { test } from "node:test";
import { failsOver } from "../src/rpc.js";

test("fails over on refusals, rate limits and server errors, never on a bad request", () => {
  for (const status of [401, 403, 408, 429, 500, 502, 503]) assert.equal(failsOver(status), true, String(status));
  for (const status of [200, 400, 404, 413]) assert.equal(failsOver(status), false, String(status));
});
