import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const bucket = 'colosseum-cox-publication-archives-dev';
const root = '/var/lib/cox-publisher';
const markers = join(root, 'backup-markers');
const request: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30_000) });
const credentials = await request('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
  headers: { 'Metadata-Flavor': 'Google' },
});
if (!credentials.ok) throw new Error(`BackupCredentialUnavailable:${credentials.status}`);
const token = (await credentials.json() as { access_token: string }).access_token;
if (!token) throw new Error('BackupCredentialMissing');
await mkdir(markers, { recursive: true, mode: 0o700 });
let uploaded = 0;
async function upload(path: string, prefix: string): Promise<void> {
  const bytes = await readFile(path);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const marker = join(markers, digest);
  try { await readFile(marker); return; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const object = `pool-0/${prefix}/${digest}.json`;
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&ifGenerationMatch=0&name=${encodeURIComponent(object)}`;
  const response = await request(url, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, 'content-type': 'application/json',
  }, body: bytes });
  if (response.status !== 412) {
    if (!response.ok) throw new Error(`BackupUploadFailed:${response.status}`);
    const result = await response.json() as { md5Hash: string };
    if (result.md5Hash !== createHash('md5').update(bytes).digest('base64')) throw new Error('BackupChecksumMismatch');
  }
  await writeFile(marker + '.tmp', object, { mode: 0o600 });
  await rename(marker + '.tmp', marker);
  console.log(JSON.stringify({ event: 'backup', object, sha256: digest, bytes: bytes.length }));
  uploaded++;
}
if (process.argv[2] === '--restore-test' && process.argv[3]) {
  await upload(process.argv[3], 'restore-tests');
} else {
  let files: string[] = [];
  try { files = await readdir(join(root, 'state.json.history')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  for (const file of files.filter(file => /^(0|[1-9][0-9]*)\.json$/.test(file))) {
    await upload(join(root, 'state.json.history', file), `history/${file.slice(0, -5)}`);
  }
  try { await upload(join(root, 'state.json'), 'journals'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
console.log(JSON.stringify({ event: 'backup-complete', uploaded, at: new Date().toISOString() }));
