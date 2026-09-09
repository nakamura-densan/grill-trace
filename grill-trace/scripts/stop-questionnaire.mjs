#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

function parseArgs(argv) {
  const result = { dir: null, port: 4173, maxPortAttempts: 20 };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[++i];
    if (value === undefined) throw new Error(`Missing value for ${arg}`);
    if (arg === '--dir') result.dir = value;
    else if (arg === '--port') result.port = Number(value);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!result.dir) throw new Error('Required: --dir <trace-directory>');
  if (!Number.isInteger(result.port) || result.port < 1 || result.port > 65535) throw new Error(`Invalid port: ${result.port}`);
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
        if (res.statusCode !== 200) return resolve(null);
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { resolve(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

function requestShutdown(port, traceId, timeoutMs = 800) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ traceId });
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/api/shutdown',
      method: 'POST',
      headers: {
        Host: `127.0.0.1:${port}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: timeoutMs,
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.end(body);
  });
}

const args = parseArgs(process.argv);
const root = path.resolve(args.dir);
const tracePath = path.join(root, 'trace.json');
if (!fs.existsSync(tracePath)) throw new Error(`trace.json not found: ${tracePath}`);
const trace = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
if (typeof trace.traceId !== 'string' || trace.traceId.length === 0) throw new Error('trace.json has no valid traceId');

for (let offset = 0; offset < args.maxPortAttempts; offset += 1) {
  const port = args.port + offset;
  if (port > 65535) break;
  const health = await requestHealth(port);
  if (!health?.ok || health.traceId !== trace.traceId) continue;
  const stopped = await requestShutdown(port, trace.traceId);
  if (!stopped) throw new Error(`Failed to stop questionnaire server on port ${port}`);
  console.log(`Stopped questionnaire server for trace ${trace.traceId} on port ${port}.`);
  process.exit(0);
}

console.log(`Questionnaire server is not running for trace ${trace.traceId}.`);
