import { crc32c } from "./crc32c.js";

const KMS_API = "https://cloudkms.googleapis.com/v1";
const VERSION_PATTERN =
  /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/locations\/[a-z0-9-]+\/keyRings\/[A-Za-z0-9_-]+\/cryptoKeys\/[A-Za-z0-9_-]+\/cryptoKeyVersions\/[1-9][0-9]*$/;

export type AccessToken = () => Promise<string>;

export interface KmsPublicKey {
  pem: string;
  algorithm: string;
  protectionLevel: string;
}

export class KmsError extends Error {}

export function assertKeyVersion(name: string): void {
  if (!VERSION_PATTERN.test(name)) throw new KmsError(`invalid KMS key version name: ${name}`);
}

async function call<T>(token: AccessToken, path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${KMS_API}/${path}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${await token()}`, "content-type": "application/json" },
  });
  const body = (await res.json()) as T & { error?: { message?: string; status?: string } };
  if (!res.ok) throw new KmsError(`KMS ${res.status} ${body.error?.status ?? ""}: ${body.error?.message ?? "request failed"}`);
  return body;
}

export async function getPublicKey(token: AccessToken, versionName: string): Promise<KmsPublicKey> {
  assertKeyVersion(versionName);
  const body = await call<{ pem: string; algorithm: string; protectionLevel: string; pemCrc32c: string }>(
    token,
    `${versionName}/publicKey`,
    { method: "GET" },
  );
  if (String(crc32c(new TextEncoder().encode(body.pem))) !== body.pemCrc32c) {
    throw new KmsError(`public key checksum mismatch for ${versionName}`);
  }
  return { pem: body.pem, algorithm: body.algorithm, protectionLevel: body.protectionLevel };
}

async function sign(token: AccessToken, versionName: string, request: Record<string, unknown>, input: Uint8Array): Promise<Uint8Array> {
  assertKeyVersion(versionName);
  if (input.length === 0) throw new KmsError("empty signing input");
  const body = await call<{
    signature: string;
    signatureCrc32c: string;
    verifiedDataCrc32c?: boolean;
    verifiedDigestCrc32c?: boolean;
    name: string;
  }>(token, `${versionName}:asymmetricSign`, { method: "POST", body: JSON.stringify(request) });
  if (body.name !== versionName) throw new KmsError(`KMS signed with ${body.name}, expected ${versionName}`);
  if (!(body.verifiedDataCrc32c ?? body.verifiedDigestCrc32c)) throw new KmsError("KMS did not verify the request checksum");
  const signature = Buffer.from(body.signature, "base64");
  if (String(crc32c(signature)) !== body.signatureCrc32c) throw new KmsError("signature checksum mismatch");
  return new Uint8Array(signature);
}

export function signData(token: AccessToken, versionName: string, data: Uint8Array): Promise<Uint8Array> {
  return sign(
    token,
    versionName,
    { data: Buffer.from(data).toString("base64"), dataCrc32c: String(crc32c(data)) },
    data,
  );
}

export function signDigest(token: AccessToken, versionName: string, digest: Uint8Array): Promise<Uint8Array> {
  if (digest.length !== 32) throw new KmsError("digest must be 32 bytes");
  return sign(
    token,
    versionName,
    { digest: { sha256: Buffer.from(digest).toString("base64") }, digestCrc32c: String(crc32c(digest)) },
    digest,
  );
}
