import { createHash } from "node:crypto";
import type { SignResult, SigningRole } from "@eox/signing";
import type { AccessToken } from "./kms.js";

export interface StoredDecision {
  requestId: string;
  caller: string;
  role: SigningRole;
  requestSha256: string;
  result: SignResult;
}

export interface DecisionStore {
  get(requestId: string): Promise<StoredDecision | null>;
  create(decision: StoredDecision): Promise<"created" | "exists">;
}

const PROJECT_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

export class FirestoreDecisionStore implements DecisionStore {
  private readonly base: string;

  constructor(
    project: string,
    private readonly token: AccessToken,
    private readonly collection = "signRequests",
  ) {
    if (!PROJECT_PATTERN.test(project)) throw new Error(`invalid project id: ${project}`);
    this.base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${collection}`;
  }

  private documentId(requestId: string): string {
    return createHash("sha256").update(requestId).digest("hex");
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${await this.token()}`, "content-type": "application/json" },
    });
  }

  async get(requestId: string): Promise<StoredDecision | null> {
    const res = await this.request(`${this.base}/${this.documentId(requestId)}`, { method: "GET" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Firestore read failed: ${res.status}`);
    const body = (await res.json()) as { fields: Record<string, { stringValue?: string }> };
    const field = (name: string) => {
      const value = body.fields[name]?.stringValue;
      if (value === undefined) throw new Error(`stored decision is missing ${name}`);
      return value;
    };
    return {
      requestId: field("requestId"),
      caller: field("caller"),
      role: field("role") as SigningRole,
      requestSha256: field("requestSha256"),
      result: JSON.parse(field("result")) as SignResult,
    };
  }

  async create(decision: StoredDecision): Promise<"created" | "exists"> {
    const fields = {
      requestId: { stringValue: decision.requestId },
      caller: { stringValue: decision.caller },
      role: { stringValue: decision.role },
      requestSha256: { stringValue: decision.requestSha256 },
      decision: { stringValue: decision.result.decision },
      result: { stringValue: JSON.stringify(decision.result) },
      createdAt: { timestampValue: new Date().toISOString() },
    };
    const res = await this.request(`${this.base}?documentId=${this.documentId(decision.requestId)}`, {
      method: "POST",
      body: JSON.stringify({ fields }),
    });
    if (res.status === 409) return "exists";
    if (!res.ok) throw new Error(`Firestore write failed: ${res.status}`);
    return "created";
  }
}
