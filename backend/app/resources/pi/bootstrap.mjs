// Installs only inside this folder; no sudo, global npm install, or policy changes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = import.meta.dirname;
process.chdir(root);
const runtime = path.join(root, '.runtime');
const evidence = path.join(root, 'evidence');
const windows = process.platform === 'win32';
const platform = windows ? 'x86_64-pc-windows-msvc' : `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`;
const hashes = {
  'aarch64-apple-darwin': '3f61099e261e449527141dbf125629fab33ad696468c8c90cebbac40185a306c',
  'x86_64-apple-darwin': '76638fdcfa91357858771551a1c88de1f7c3b270b33ab1866f8a0618d9e442d8',
  'x86_64-pc-windows-msvc': '5049375aa2a5162f132b2c1cb992e25d42d47d934cab8c174dbe6f60973dcc12',
};
fs.mkdirSync(evidence, { recursive: true });
fs.mkdirSync(runtime, { recursive: true });
const log = (type, extra = {}) => fs.appendFileSync(path.join(evidence, 'events.jsonl'), JSON.stringify({ type, at: new Date().toISOString(), ...extra }) + '\n');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) throw new Error(`Command failed: ${path.basename(command)} (exit ${result.status})`);
  return result;
}
log('setup_started', { node: process.version, platform });
try {
  const uv = windows ? path.join(runtime, 'uv.exe') : path.join(runtime, `uv-${platform}`, 'uv');
  if (!fs.existsSync(uv)) {
    const ext = windows ? 'zip' : 'tar.gz';
    const response = await fetch(`https://github.com/astral-sh/uv/releases/download/0.8.22/uv-${platform}.${ext}`, { signal: AbortSignal.timeout(300000) });
    if (!response.ok) throw new Error('Python installer download failed');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== hashes[platform]) throw new Error('Python installer checksum failed');
    const file = path.join(runtime, `uv.${ext}`);
    fs.writeFileSync(file, bytes);
    // tar.exe is included with current Windows 10/11 and can expand ZIP archives.
    run(windows ? 'tar.exe' : 'tar', ['-xf', file, '-C', runtime]);
  }
  const env = { ...process.env, UV_PYTHON_INSTALL_DIR: path.join(runtime, 'python'), UV_CACHE_DIR: path.join(runtime, 'uv-cache'), UV_PYTHON_BIN_DIR: path.join(runtime, 'bin') };
  run(uv, ['python', 'install', '3.12.11'], { env });
  const located = spawnSync(uv, ['python', 'find', '--managed-python', '3.12.11'], { env, encoding: 'utf8' });
  if (located.status !== 0) throw new Error('Python not found after installation');
  const python = located.stdout.trim();
  const nodeHome = path.dirname(process.execPath);
  const cli = path.join(runtime, 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js');
  if (!fs.existsSync(cli)) {
    const npm = windows ? path.join(nodeHome, 'node_modules/npm/bin/npm-cli.js') : path.join(nodeHome, '../lib/node_modules/npm/bin/npm-cli.js');
    run(process.execPath, [npm, 'install', '--prefix', runtime, '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', '@earendil-works/pi-coding-agent@0.85.1']);
  }
  env.PATH = `${path.dirname(python)}${path.delimiter}${nodeHome}${path.delimiter}${env.PATH}`;
  env.PI_CODING_AGENT_DIR = path.join(runtime, 'pi-user');
  fs.mkdirSync(env.PI_CODING_AGENT_DIR, { recursive: true });
  fs.writeFileSync(path.join(env.PI_CODING_AGENT_DIR, 'settings.json'), JSON.stringify({ defaultProvider: 'deepseek', defaultModel: 'deepseek-chat', defaultTools: ['read', windows ? 'powershell' : 'bash', 'edit', 'write'] }));
  log('setup_finished', { python: '3.12.11', pi: '0.85.1' });
  if (process.argv.includes('--setup-only')) {
    run(process.execPath, [cli, '--version'], { env });
    console.log('环境检查通过；尚未启动模型或开始计时。');
    process.exit(0);
  }
  console.log('\n第一次进入 Pi：输入 /login，选择 DeepSeek，粘贴老师单独给你的密钥。不要把密钥发到对话里。\n结束时输入 /quit，随后会生成作品压缩包。\n');
  const sessions = path.join(evidence, 'sessions');
  fs.mkdirSync(sessions, { recursive: true });
  const args = [cli, '--session-dir', sessions, '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--append-system-prompt', fs.readFileSync('AGENTS.md', 'utf8'), '--provider', 'deepseek', '--model', 'deepseek-chat', '--tools', `read,${windows ? 'powershell' : 'bash'},edit,write`];
  if (fs.readdirSync(sessions).some(file => file.endsWith('.jsonl'))) args.push('--continue');
  log('work_started');
  const result = spawnSync(process.execPath, args, { cwd: path.join(root, 'project'), env, stdio: 'inherit' });
  log('work_stopped', { exit_code: result.status, signal: result.signal });
  run(python, [path.join(root, 'pack.py')]);
} catch (error) {
  log('setup_or_launch_failed', { message: error.message });
  console.error('没有完成启动：', error.message, '\n请把这个窗口给老师看。已保存的文件不会被清空。');
  process.exitCode = 1;
}
