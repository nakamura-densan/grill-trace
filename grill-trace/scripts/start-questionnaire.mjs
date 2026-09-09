#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

function parseArgs(argv) {
  const result = { dir: null, port: 4173, maxPortAttempts: 20, idleTimeoutMinutes: 30 };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[++i];
    if (value === undefined) throw new Error(`Missing value for ${arg}`);
    if (arg === '--dir') result.dir = value;
    else if (arg === '--port') result.port = Number(value);
    else if (arg === '--idle-timeout-minutes') result.idleTimeoutMinutes = Number(value);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!result.dir) throw new Error('Required: --dir <trace-directory>');
  if (!Number.isInteger(result.port) || result.port < 1 || result.port > 65535) {
    throw new Error(`Invalid port: ${result.port}`);
  }
  if (!Number.isFinite(result.idleTimeoutMinutes) || result.idleTimeoutMinutes <= 0 || result.idleTimeoutMinutes > 1440) {
    throw new Error(`Invalid idle timeout minutes: ${result.idleTimeoutMinutes}`);
  }
  return result;
}

function requestHealth(port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const req = http.get({
      hostname: '127.0.0.1',
      port,
      path: '/api/health',
      headers: { Host: `127.0.0.1:${port}` },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
  });
}

function canBind(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.unref();
    tester.once('error', () => resolve(false));
    tester.listen(port, '127.0.0.1', () => tester.close(() => resolve(true)));
  });
}

async function findExistingServer(start, attempts, traceId) {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = start + offset;
    if (port > 65535) break;
    const health = await requestHealth(port);
    if (health?.ok && health.traceId === traceId) return { port, health };
  }
  return null;
}

async function findFreePort(start, attempts) {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = start + offset;
    if (port > 65535) break;
    if (await canBind(port)) return port;
  }
  throw new Error(`No free localhost port found from ${start} (${attempts} attempts)`);
}

async function waitForHealth(port, attempts = 30) {
  for (let i = 0; i < attempts; i += 1) {
    const health = await requestHealth(port);
    if (health?.ok) return health;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

const args = parseArgs(process.argv);
const root = path.resolve(args.dir);
const tracePath = path.join(root, 'trace.json');
const serveScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'serve-questionnaire.mjs');

if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  throw new Error(`Directory not found: ${root}`);
}
if (!fs.existsSync(tracePath)) throw new Error(`trace.json not found: ${tracePath}`);
const trace = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
if (typeof trace.traceId !== 'string' || trace.traceId.length === 0) throw new Error('trace.json has no valid traceId');

const existing = await findExistingServer(args.port, args.maxPortAttempts, trace.traceId);
if (existing) {
  console.log(`Questionnaire URL: http://127.0.0.1:${existing.port}/`);
  console.log(`Server already running for trace ${trace.traceId}.`);
  console.log(`Idle timeout: ${existing.health.idleTimeoutMinutes} minutes after the last questionnaire page closes.`);
  process.exit(0);
}

const port = await findFreePort(args.port, args.maxPortAttempts);
const child = spawn(process.execPath, [
  serveScript,
  '--dir', root,
  '--port', String(port),
  '--idle-timeout-minutes', String(args.idleTimeoutMinutes),
], {
  cwd: process.cwd(),
  detached: true,
  windowsHide: true,
  stdio: 'ignore',
});
child.unref();

const health = await waitForHealth(port);
if (!health || health.traceId !== trace.traceId) {
  try { process.kill(child.pid, 'SIGTERM'); } catch {}
  throw new Error('Questionnaire server failed to start. Run serve-questionnaire.mjs in the foreground for diagnostics.');
}

console.log(`Questionnaire URL: http://127.0.0.1:${port}/`);
console.log(`Server PID: ${child.pid}`);
console.log(`Idle timeout: ${args.idleTimeoutMinutes} minutes after the last questionnaire page closes.`);
