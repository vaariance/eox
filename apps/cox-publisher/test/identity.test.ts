import assert from "node:assert/strict";
import test from "node:test";
import { createPublisherIdentityToken, PUBLISHER_IDENTITY } from "../src/identity.ts";

const audience = "https://signer.getrelative.trade";

test("uses VM access credentials to mint the dedicated publisher identity with email", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const request: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(calls.length === 1 ? { access_token: "vm-access", token_type: "Bearer" } : { token: "publisher-identity" });
  };
  assert.equal(await createPublisherIdentityToken(audience, request)(), "publisher-identity");
  assert.equal(calls.length, 2);
  assert.ok(calls[0]!.url.endsWith("/service-accounts/default/token"));
  assert.deepEqual(calls[0]!.init?.headers, { "Metadata-Flavor": "Google" });
  assert.equal(calls[1]!.url, `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${PUBLISHER_IDENTITY}:generateIdToken`);
  assert.equal(calls[1]!.init?.method, "POST");
  assert.deepEqual(JSON.parse(calls[1]!.init?.body as string), { audience, includeEmail: true });
  assert.deepEqual(calls[1]!.init?.headers, { authorization: "Bearer vm-access", "content-type": "application/json" });
});

test("metadata failures and malformed credentials never reach IAM", async () => {
  for (const response of [new Response("", { status: 403 }), Response.json({ access_token: "", token_type: "Bearer" }),
    Response.json({ access_token: "vm-access", token_type: "Other" }), Response.json(null)]) {
    let calls = 0;
    const request: typeof fetch = async () => { calls++; return response; };
    await assert.rejects(createPublisherIdentityToken(audience, request)());
    assert.equal(calls, 1);
  }
});

test("IAM rejection or missing token fails without exposing response credentials", async () => {
  for (const response of [new Response("sensitive-detail", { status: 403 }), Response.json({ token: "" }), Response.json({}),
    Response.json({ token: "a".repeat(16385) })]) {
    let calls = 0;
    const request: typeof fetch = async () => ++calls === 1 ? Response.json({ access_token: "vm-access", token_type: "Bearer" }) : response;
    await assert.rejects(createPublisherIdentityToken(audience, request)(), error => error instanceof Error && !error.message.includes("sensitive-detail") && !error.message.includes("vm-access"));
  }
});
