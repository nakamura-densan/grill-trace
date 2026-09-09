#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = new Map();
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`Invalid arguments near: ${key ?? ''}`);
    args.set(key.slice(2), value);
  }
  return args;
}

const args = parseArgs(process.argv);
const tracePath = args.get('trace');
const templatePath = args.get('template');
const outputPath = args.get('output');

if (!tracePath || !templatePath || !outputPath) {
  throw new Error('Required: --trace <file> --template <file> --output <file>');
}

const trace = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
if (trace.version !== 1 || typeof trace.traceId !== 'string' || !Array.isArray(trace.rounds)) {
  throw new Error('Invalid trace.json');
}

const traceRoot = path.dirname(path.resolve(tracePath));
for (const descriptor of trace.rounds) {
  if (typeof descriptor.file !== 'string' || !/^rounds\/[A-Za-z0-9._-]+\.json$/.test(descriptor.file)) {
    throw new Error(`Invalid round file: ${descriptor.id ?? ''}`);
  }
  const roundPath = path.resolve(traceRoot, descriptor.file);
  if (!fs.existsSync(roundPath)) throw new Error(`Round file not found: ${descriptor.file}`);
  const round = JSON.parse(fs.readFileSync(roundPath, 'utf8'));
  if (!Array.isArray(round.questions)) throw new Error(`Invalid round questions: ${descriptor.id}`);
  for (const question of round.questions) {
    if (!['single', 'multiple'].includes(question.type)) throw new Error(`Invalid question type: ${question.id}`);
    if (!Array.isArray(question.options) || question.options.length < 2) {
      throw new Error(`Question must have at least two options: ${question.id}`);
    }
    const otherOptions = question.options.filter((option) => option.isOther === true);
    if (otherOptions.length !== 1) {
      throw new Error(`Question must have exactly one Other option: ${question.id}`);
    }
  }
}

const html = fs.readFileSync(templatePath, 'utf8');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, html, 'utf8');
console.log(outputPath);
