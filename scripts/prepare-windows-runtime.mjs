import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile, mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// SmarterASP builds on Linux but extracts /app onto Windows IIS.
// Windows dependencies beside the compiled server take precedence over the
// Linux builder's node_modules. Never copy a private .env.
const root = fileURLToPath(new URL('../', import.meta.url));
const target = path.join(root, 'runtime');
await mkdir(target, {recursive: true});
await readFile(path.join(target, 'server/index.js'));
for (const file of ['package.json', 'package-lock.json']) {
  await copyFile(path.join(root, file), path.join(target, file));
}
if (!process.env.npm_execpath) throw new Error('Run this script with npm run build:windows-runtime.');
execFileSync(process.execPath, [process.env.npm_execpath, 'ci', '--prefix', target,
  '--omit=dev', '--include=optional', '--ignore-scripts', '--os=win32', '--cpu=x64',
  '--no-audit', '--no-fund'], {cwd: root, stdio: 'inherit'});

// Fail if npm silently skipped the required Windows image library.
const sharpLib = path.join(target, 'node_modules/@img/sharp-win32-x64/lib');
const sharpNative = (await readdir(sharpLib)).find(file => file.startsWith('sharp-win32-x64') && file.endsWith('.node'));
if (!sharpNative) throw new Error('Missing Windows x64 Sharp binary.');
const sharpHeader = await readFile(path.join(sharpLib, sharpNative));
if (sharpHeader.subarray(0, 2).toString() !== 'MZ') throw new Error('Missing Windows x64 Sharp binary.');

// Match the Node 24 build version and verify the official release checksum.
const version = process.versions.node;
if (!/^24\.\d+\.\d+$/.test(version)) throw new Error('Build the Windows host package with Node 24.');
const base = `https://nodejs.org/dist/v${version}/`;
async function download(relative) {
  const response = await fetch(new URL(relative, base), {signal: AbortSignal.timeout(120000)});
  if (!response.ok) throw new Error(`Node release download failed: ${relative} (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}
const checksums = (await download('SHASUMS256.txt')).toString('utf8');
const expected = checksums.split(/\r?\n/).find(line => /\swin-x64\/node\.exe$/.test(line))?.split(/\s+/)[0];
if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('Windows Node checksum is missing from the release.');
const executable = await download('win-x64/node.exe');
if (createHash('sha256').update(executable).digest('hex') !== expected) throw new Error('Windows Node checksum mismatch.');
await writeFile(path.join(target, 'node.exe'), executable);
await writeFile(path.join(target, 'windows-build.json'), JSON.stringify({node: version, platform: 'win32', arch: 'x64', nodeSha256: expected}, null, 2) + '\n');
console.log(`Windows IIS runtime prepared: Node ${version}, compiled server and Windows x64 dependencies.`);
