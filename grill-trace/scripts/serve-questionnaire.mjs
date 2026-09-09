#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

function parseArgs(argv) {
  const result = { dir: null, port: 4173, idleTimeoutMinutes: 30 };
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
  if (!Number.isInteger(result.port) || result.port < 1 || result.port > 65535) throw new Error(`Invalid port: ${result.port}`);
  if (!Number.isFinite(result.idleTimeoutMinutes) || result.idleTimeoutMinutes <= 0 || result.idleTimeoutMinutes > 1440) {
    throw new Error(`Invalid idle timeout minutes: ${result.idleTimeoutMinutes}`);
  }
  return result;
}

function baseHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'",
  };
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, { ...baseHeaders('application/json; charset=utf-8'), 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function validateTrace(trace) {
  if (trace.version !== 1) throw new Error(`Unsupported trace version: ${trace.version}`);
  for (const field of ['traceId', 'title', 'evidenceFolder']) {
    if (typeof trace[field] !== 'string' || trace[field].length === 0) throw new Error(`${field} must be a non-empty string`);
  }
  if (!['in_progress', 'completed'].includes(trace.status)) throw new Error(`Invalid trace status: ${trace.status}`);
  if (!Array.isArray(trace.rounds)) throw new Error('rounds must be an array');
  const ids = new Set();
  for (const round of trace.rounds) {
    if (typeof round.id !== 'string' || round.id.length === 0 || ids.has(round.id)) throw new Error(`Invalid or duplicate round ID: ${round.id}`);
    ids.add(round.id);
    if (!Number.isInteger(round.order) || round.order < 1) throw new Error(`Invalid round order: ${round.id}`);
    if (typeof round.title !== 'string' || round.title.length === 0) throw new Error(`Invalid round title: ${round.id}`);
    if (!['pending', 'answered'].includes(round.status)) throw new Error(`Invalid round status: ${round.id}`);
    if (typeof round.file !== 'string' || !/^rounds\/[A-Za-z0-9._-]+\.json$/.test(round.file)) throw new Error(`Invalid round file: ${round.id}`);
  }
  if (trace.currentRoundId !== null && trace.currentRoundId !== undefined && !ids.has(trace.currentRoundId)) {
    throw new Error(`Unknown currentRoundId: ${trace.currentRoundId}`);
  }
}

function normalizeResponse(response) {
  return {
    selected: Array.isArray(response?.selected) ? response.selected.filter((v) => typeof v === 'string') : [],
    selectedLabels: Array.isArray(response?.selectedLabels) ? response.selectedLabels.filter((v) => typeof v === 'string') : [],
    freeText: typeof response?.freeText === 'string' ? response.freeText : '',
  };
}

function validateResponse(question, response) {
  const normalized = normalizeResponse(response);
  if (question.type === 'single' && normalized.selected.length > 1) throw new Error(`single question has multiple selections: ${question.id}`);
  const optionMap = new Map((question.options ?? []).map((option) => [option.id, option.label]));
  for (const selected of normalized.selected) {
    if (!optionMap.has(selected)) throw new Error(`Unknown option ID: ${question.id}/${selected}`);
  }
  const expectedLabels = normalized.selected.map((id) => optionMap.get(id));
  if (JSON.stringify(expectedLabels) !== JSON.stringify(normalized.selectedLabels)) throw new Error(`selectedLabels mismatch: ${question.id}`);
  const otherOption = (question.options ?? []).find((option) => option.isOther === true);
  const otherSelected = otherOption ? normalized.selected.includes(otherOption.id) : false;
  if (otherSelected && normalized.freeText.trim().length === 0) throw new Error(`Other option requires free text: ${question.id}`);
  return normalized;
}

function validateRound(round, expectedTraceId, expectedRoundId) {
  if (round.version !== 1) throw new Error(`Unsupported round version: ${round.version}`);
  if (round.traceId !== expectedTraceId) throw new Error(`Round traceId mismatch: ${expectedRoundId}`);
  if (round.roundId !== expectedRoundId) throw new Error(`Round ID mismatch: ${expectedRoundId}`);
  if (!Array.isArray(round.questions)) throw new Error(`questions must be an array: ${expectedRoundId}`);
  const questionIds = new Set();
  for (const question of round.questions) {
    if (typeof question.id !== 'string' || question.id.length === 0 || questionIds.has(question.id)) throw new Error(`Invalid or duplicate question ID: ${question.id}`);
    questionIds.add(question.id);
    if (!['single', 'multiple'].includes(question.type)) throw new Error(`Invalid question type: ${question.id}`);
    if (typeof question.title !== 'string' || question.title.length === 0) throw new Error(`Invalid question title: ${question.id}`);
    if (question.recommendation !== undefined && question.recommendation !== null && typeof question.recommendation !== 'string') throw new Error(`Invalid recommendation: ${question.id}`);
    const optionIds = new Set();
    if (!Array.isArray(question.options) || question.options.length < 2) throw new Error(`Question must have at least two options: ${question.id}`);
    let otherOptionCount = 0;
    for (const option of question.options) {
      if (typeof option.id !== 'string' || optionIds.has(option.id)) throw new Error(`Invalid or duplicate option ID: ${question.id}/${option.id}`);
      optionIds.add(option.id);
      if (typeof option.label !== 'string') throw new Error(`Invalid option label: ${question.id}/${option.id}`);
      if (option.isOther === true) otherOptionCount += 1;
      else if (option.isOther !== undefined && option.isOther !== false) throw new Error(`Invalid isOther flag: ${question.id}/${option.id}`);
    }
    if (otherOptionCount !== 1) throw new Error(`Question must have exactly one Other option: ${question.id}`);
    if (question.response !== null && question.response !== undefined) validateResponse(question, question.response);
  }
}

function roundStructureSnapshot(round) {
  return {
    version: round.version,
    traceId: round.traceId,
    roundId: round.roundId,
    order: round.order,
    title: round.title,
    description: round.description ?? '',
    createdAt: round.createdAt ?? null,
    questions: round.questions.map((question) => ({
      id: question.id,
      type: question.type,
      title: question.title,
      description: question.description ?? '',
      recommendation: question.recommendation ?? '',
      required: Boolean(question.required),
      placeholder: question.placeholder ?? '',
      options: (question.options ?? []).map((option) => ({
        id: option.id,
        label: option.label,
        description: option.description ?? '',
        recommended: Boolean(option.recommended),
        isOther: Boolean(option.isOther),
      })),
    })),
  };
}

function isAnswered(question) {
  if (!question.required) return true;
  const response = normalizeResponse(question.response);
  if (response.selected.length === 0) return false;
  const otherOption = (question.options ?? []).find((option) => option.isOther === true);
  return !otherOption || !response.selected.includes(otherOption.id) || response.freeText.trim().length > 0;
}

function mergeRoundResponses(current, incoming) {
  validateRound(current, current.traceId, current.roundId);
  validateRound(incoming, current.traceId, current.roundId);
  if (JSON.stringify(roundStructureSnapshot(current)) !== JSON.stringify(roundStructureSnapshot(incoming))) {
    throw new Error('Round definition changed. Reload the questionnaire and try again.');
  }
  const incomingById = new Map(incoming.questions.map((question) => [question.id, question]));
  const now = new Date().toISOString();
  const merged = structuredClone(current);
  for (const question of merged.questions) {
    const incomingQuestion = incomingById.get(question.id);
    const response = incomingQuestion?.response ?? null;
    if (response === null) {
      if (question.response !== null && question.response !== undefined) {
        question.response = null;
        question.answeredAt = null;
      }
      continue;
    }
    const normalized = validateResponse(question, response);
    const previous = question.response === null || question.response === undefined ? null : normalizeResponse(question.response);
    if (JSON.stringify(previous) !== JSON.stringify(normalized)) {
      question.response = normalized;
      question.answeredAt = now;
    }
  }
  merged.updatedAt = now;
  return merged;
}

const args = parseArgs(process.argv);
const root = path.resolve(args.dir);
const htmlPath = path.join(root, 'questionnaire.html');
const tracePath = path.join(root, 'trace.json');
const roundsRoot = path.join(root, 'rounds');
const idleTimeoutMs = args.idleTimeoutMinutes * 60 * 1000;
const expectedOrigin = `http://127.0.0.1:${args.port}`;
const presenceClients = new Set();
let lastActivityAt = Date.now();
let shuttingDown = false;

for (const requiredPath of [htmlPath, tracePath, roundsRoot]) {
  if (!fs.existsSync(requiredPath)) throw new Error(`Required path not found: ${requiredPath}`);
}
validateTrace(readJson(tracePath));

function touchActivity() { lastActivityAt = Date.now(); }

function getRoundDescriptor(roundId) {
  const trace = readJson(tracePath);
  validateTrace(trace);
  const descriptor = trace.rounds.find((round) => round.id === roundId);
  if (!descriptor) throw new Error(`Unknown round ID: ${roundId}`);
  const resolved = path.resolve(root, descriptor.file);
  const relative = path.relative(roundsRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Invalid round path: ${roundId}`);
  if (!fs.existsSync(resolved)) throw new Error(`Round file not found: ${descriptor.file}`);
  return { trace, descriptor, filePath: resolved };
}

function markRoundStatus(roundId, status) {
  const trace = readJson(tracePath);
  validateTrace(trace);
  const descriptor = trace.rounds.find((round) => round.id === roundId);
  if (!descriptor) throw new Error(`Unknown round ID: ${roundId}`);
  descriptor.status = status;
  trace.updatedAt = new Date().toISOString();
  writeJsonAtomic(tracePath, trace);
}

function shutdown(reason, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Stopping questionnaire server: ${reason}`);
  for (const res of presenceClients) {
    try { res.end(); } catch {}
  }
  presenceClients.clear();
  server.close(() => process.exit(code));
  setTimeout(() => process.exit(code), 1000).unref();
}

const server = http.createServer((req, res) => {
  const host = req.headers.host;
  if (host !== `127.0.0.1:${args.port}` && host !== `localhost:${args.port}`) {
    sendJson(res, 403, { error: 'Invalid host' });
    return;
  }
  const url = new URL(req.url, expectedOrigin);
  touchActivity();

  if (req.method === 'GET' && url.pathname === '/api/health') {
    const trace = readJson(tracePath);
    sendJson(res, 200, {
      ok: true,
      traceId: trace.traceId,
      presenceClients: presenceClients.size,
      idleTimeoutMinutes: args.idleTimeoutMinutes,
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/presence') {
    res.writeHead(200, {
      ...baseHeaders('text/event-stream; charset=utf-8'),
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('event: ready\ndata: {}\n\n');
    presenceClients.add(res);
    req.on('close', () => {
      presenceClients.delete(res);
      touchActivity();
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/trace') {
    try {
      const trace = readJson(tracePath);
      validateTrace(trace);
      sendJson(res, 200, trace);
    } catch (error) {
      sendJson(res, 500, { error: `Failed to read trace.json: ${error.message}` });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/shutdown') {
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.toLowerCase().startsWith('application/json')) {
      sendJson(res, 415, { error: 'Content-Type must be application/json' });
      return;
    }
    let size = 0;
    const chunks = [];
    let rejected = false;
    req.on('data', (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > 4096) {
        rejected = true;
        sendJson(res, 413, { error: 'Payload too large' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) return;
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const trace = readJson(tracePath);
        validateTrace(trace);
        if (payload.traceId !== trace.traceId) {
          sendJson(res, 403, { error: 'Trace ID mismatch' });
          return;
        }
        sendJson(res, 200, { ok: true });
        setImmediate(() => shutdown('explicit stop request', 0));
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
    });
    return;
  }

  const roundMatch = url.pathname.match(/^\/api\/rounds\/([^/]+)$/);
  if (roundMatch && req.method === 'GET') {
    try {
      const roundId = decodeURIComponent(roundMatch[1]);
      const { trace, filePath } = getRoundDescriptor(roundId);
      const round = readJson(filePath);
      validateRound(round, trace.traceId, roundId);
      sendJson(res, 200, round);
    } catch (error) {
      sendJson(res, 404, { error: error.message });
    }
    return;
  }

  if (roundMatch && req.method === 'PUT') {
    if (req.headers.origin !== expectedOrigin) {
      sendJson(res, 403, { error: 'Invalid origin' });
      return;
    }
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.toLowerCase().startsWith('application/json')) {
      sendJson(res, 415, { error: 'Content-Type must be application/json' });
      return;
    }
    let size = 0;
    const chunks = [];
    let rejected = false;
    req.on('data', (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > 1024 * 1024) {
        rejected = true;
        sendJson(res, 413, { error: 'Payload too large' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) return;
      try {
        const roundId = decodeURIComponent(roundMatch[1]);
        const { trace, filePath } = getRoundDescriptor(roundId);
        const current = readJson(filePath);
        const incoming = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        validateRound(current, trace.traceId, roundId);
        const merged = mergeRoundResponses(current, incoming);
        writeJsonAtomic(filePath, merged);
        const status = merged.questions.every(isAnswered) ? 'answered' : 'pending';
        markRoundStatus(roundId, status);
        touchActivity();
        sendJson(res, 200, merged);
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
    });
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/questionnaire.html')) {
    const body = fs.readFileSync(htmlPath);
    res.writeHead(200, { ...baseHeaders('text/html; charset=utf-8'), 'Content-Length': body.length });
    res.end(body);
    return;
  }

  res.writeHead(404, baseHeaders('text/plain; charset=utf-8'));
  res.end('Not found');
});

const presenceKeepAliveTimer = setInterval(() => {
  for (const res of [...presenceClients]) {
    try { res.write(': keepalive\n\n'); } catch { presenceClients.delete(res); }
  }
}, 15000);
presenceKeepAliveTimer.unref();

const idleCheckTimer = setInterval(() => {
  if (presenceClients.size > 0) return;
  if (Date.now() - lastActivityAt < idleTimeoutMs) return;
  shutdown(`idle timeout (${args.idleTimeoutMinutes} minutes with no open questionnaire)`, 0);
}, Math.min(30000, Math.max(1000, idleTimeoutMs / 6)));
idleCheckTimer.unref();

server.listen(args.port, '127.0.0.1', () => {
  console.log(`Questionnaire server: ${expectedOrigin}/`);
  console.log(`Trace index: ${tracePath}`);
  console.log(`Idle timeout: ${args.idleTimeoutMinutes} minutes after the last questionnaire page disconnects.`);
});

process.on('SIGTERM', () => shutdown('SIGTERM', 0));
process.on('SIGINT', () => shutdown('SIGINT', 0));
