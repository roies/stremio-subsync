'use strict';

const fs = require('fs');
const path = require('path');

function parseEnv(content) {
  const values = {};
  content.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  });
  return values;
}

function loadEnvFile(filePath = path.join(__dirname, '.env'), env = process.env) {
  if (!fs.existsSync(filePath)) return env;
  const parsed = parseEnv(fs.readFileSync(filePath, 'utf8'));
  Object.entries(parsed).forEach(([key, value]) => {
    if (env[key] === undefined || env[key] === '') {
      env[key] = value;
    }
  });
  return env;
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const values = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const rawKey = arg.slice(2);
    const eqIndex = rawKey.indexOf('=');
    const key = eqIndex >= 0 ? rawKey.slice(0, eqIndex) : rawKey;
    const normalized = key.replace(/-/g, '_').toUpperCase();
    let value;
    if (eqIndex >= 0) {
      value = rawKey.slice(eqIndex + 1);
    } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
      value = argv[i + 1];
      i += 1;
    } else {
      value = 'true';
    }
    values[normalized] = value;
  }
  return values;
}

function applyCliOverrides(argv = process.argv.slice(2), env = process.env) {
  Object.entries(parseCliArgs(argv)).forEach(([key, value]) => {
    env[key] = value;
  });
  return env;
}

module.exports = { parseEnv, loadEnvFile, parseCliArgs, applyCliOverrides };
