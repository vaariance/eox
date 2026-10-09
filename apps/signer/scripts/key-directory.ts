import { loadSignerConfig } from "../src/config.js";
import { keyDirectory, resolveKeys } from "../src/directory.js";

const [configPath] = process.argv.slice(2);
const accessToken = process.env.GOOGLE_ACCESS_TOKEN;
if (!configPath || !accessToken) {
  console.error("usage: GOOGLE_ACCESS_TOKEN=$(gcloud auth print-access-token) key-directory <config.json>");
  process.exit(2);
}
const config = loadSignerConfig(configPath);
const keys = await resolveKeys(config, async () => accessToken);
const version = Number(process.env.KEY_DIRECTORY_VERSION ?? "1");
if (!Number.isSafeInteger(version) || version < 1) throw new Error("KEY_DIRECTORY_VERSION must be a positive integer");
console.log(JSON.stringify(keyDirectory(config, keys, version, Math.floor(Date.now() / 1000)), null, 2));
