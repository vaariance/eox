export const PUBLISHER_IDENTITY = "cox-publisher@colosseum-eox.iam.gserviceaccount.com";
const METADATA_TOKEN = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
const ID_TOKEN = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${PUBLISHER_IDENTITY}:generateIdToken`;

function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[name] : undefined;
}

export function createPublisherIdentityToken(audience: string, request: typeof fetch): () => Promise<string> {
  return async () => {
    const metadata = await request(METADATA_TOKEN, { headers: { "Metadata-Flavor": "Google" } });
    if (!metadata.ok) throw new Error("VmCredentialUnavailable:" + metadata.status);
    const credentials: unknown = await metadata.json();
    const accessToken = field(credentials, "access_token");
    if (typeof accessToken !== "string" || !accessToken || accessToken.length > 16_384
        || field(credentials, "token_type") !== "Bearer") throw new Error("InvalidVmCredential");
    const response = await request(ID_TOKEN, { method: "POST", headers: {
      authorization: `Bearer ${accessToken}`, "content-type": "application/json",
    }, body: JSON.stringify({ audience, includeEmail: true }) });
    if (!response.ok) throw new Error("PublisherIdentityUnavailable:" + response.status);
    const token = field(await response.json(), "token");
    if (typeof token !== "string" || !token || token.length > 16_384) throw new Error("InvalidPublisherIdentityToken");
    return token;
  };
}
