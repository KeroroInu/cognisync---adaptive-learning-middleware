// Self-host a pinned upstream build. No student diagrams are sent to diagrams.net.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const version = '32.3.0';
const digest = 'f554a8d8c897b626779e96959b7a2a617c1ead9817a50e78e0facaca3fdcc044';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const target = path.join(root, 'drawio');
const marker = path.join(target, 'sfls-vendor.json');
if (existsSync(marker) && JSON.parse(readFileSync(marker, 'utf8')).sha256 === digest) {
  console.log(`draw.io ${version}: verified local build available`);
} else {
  if (existsSync(target)) throw new Error('Existing drawio directory is not this pinned build; preserve it and resolve manually.');
  const url = `https://github.com/jgraph/drawio/releases/download/v${version}/draw.war`;
  console.log(`Preparing self-hosted draw.io ${version} from upstream…`);
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`draw.io download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error('draw.io checksum mismatch');
  const temp = mkdtempSync(path.join(tmpdir(), 'sfls-drawio-'));
  const archive = path.join(temp, 'draw.war');
  writeFileSync(archive, bytes);
  const names = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).split('\n').filter(Boolean);
  if (names.some(name => name.startsWith('/') || name.split('/').includes('..') || name.includes('\\'))) throw new Error('Unsafe upstream archive path');
  mkdirSync(root, { recursive: true });
  const staged = mkdtempSync(path.join(root, '.drawio-stage-'));
  // Only static browser assets are required; do not deploy the Java server.
  execFileSync('unzip', ['-q', archive, '-x', 'WEB-INF/*', 'META-INF/*', '-d', staged]);
  writeFileSync(path.join(staged, 'sfls-vendor.json'), JSON.stringify({ version, sha256: digest, url }));
  renameSync(staged, target);
  console.log(`draw.io ready at ${target}; checksum verified. Temporary archive retained at ${archive}`);
}
