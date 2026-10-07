import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { encodeRule, encodeEvidence, encodeSlot, evidenceDigest, integer, type Rule, type Slot } from "../src/codec.js";
const Q=1_000_000n;
// Independent bigint reference: deliberately does not call the Rust implementation.
function div(n:bigint,d:bigint):bigint{if(d<=0n)throw new Error("denominator");const r=n%d;return n/d+(2n*(r<0n?-r:r)>=d?(n<0n?-1n:1n):0n);}
function reference(a:bigint,b:bigint,a0:bigint,b0:bigint,m=20n){const denominator=b*a0;const numerator=a*b0-denominator;return {ratio:div(a*Q,b),change:div(numerator*Q,denominator),expressed:div(100n*Q*(denominator+m*numerator),denominator)};}
test("independent reference vectors: baseline, 103, signed output and reciprocal",()=>{
  assert.equal(reference(100n*Q,100n*Q,100n*Q,100n*Q).expressed,100n*Q);
  assert.equal(reference(100_150_000n,100n*Q,100n*Q,100n*Q).expressed,103n*Q);
  assert.ok(reference(50n*Q,150n*Q,100n*Q,100n*Q).expressed<0n);
  const up=reference(110n*Q,100n*Q,100n*Q,100n*Q); const down=reference(100n*Q,110n*Q,100n*Q,100n*Q);assert.notEqual(up.change,-down.change);
  assert.equal(div(1n,2n),1n);assert.equal(div(-1n,2n),-1n);
});
test("canonical codec sizes match Rust layout and identity changes with content",async()=>{
  const fixture=JSON.parse(await readFile(new URL("../../../packages/oracle/fixtures/baseline.json",import.meta.url),"utf8")) as {countries:{rules:Rule[];slots:Slot[]}[]};
  const country=fixture.countries[0]!; const slot=country.slots[0]!;
  assert.equal(encodeEvidence(slot.current).length,250); assert.ok(encodeRule(country.rules[0]!).length<=192);assert.ok(encodeSlot(slot).length<=640);
  const original=evidenceDigest(slot.current);assert.notDeepEqual(original,evidenceDigest({...slot.current,value:(integer(slot.current.value)+1n).toString()}));
  assert.equal(original.toString("hex"),"f8aea148d0637441d7770f5b24b525e1eea7238304ed031c3ccad029dee58fb9");
  assert.deepEqual(original,evidenceDigest({...slot.current,record_id:Array(32).fill(7),known_at:999,recorded_at:1000}));
  assert.throws(()=>integer(Number.MAX_SAFE_INTEGER+1),/UnsafeInteger/);
});
