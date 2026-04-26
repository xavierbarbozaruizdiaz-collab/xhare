#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

function parseEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function loadEnvSnapshot() {
  const root = process.cwd();
  const files = [
    path.join(root, '.env'),
    path.join(root, '.env.local'),
    path.join(root, 'mobile-app', '.env'),
    path.join(root, 'mobile-app', '.env.local'),
  ];
  const merged = {};
  for (const fp of files) Object.assign(merged, parseEnvFile(fp));
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') merged[k] = v;
  }
  return merged;
}

function missingOrPlaceholder(v) {
  if (!v || !String(v).trim()) return true;
  const s = String(v).trim().toLowerCase();
  return (
    s.includes('placeholder') ||
    s === 'changeme' ||
    s === 'your_key_here' ||
    s === 'your-api-key' ||
    s === 'null' ||
    s === 'undefined'
  );
}

function run() {
  const env = loadEnvSnapshot();
  const strictMode = process.argv.includes('--strict');
  const errors = [];
  const warnings = [];
  const oks = [];

  const mustHave = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];
  for (const key of mustHave) {
    if (missingOrPlaceholder(env[key])) {
      errors.push(`Missing or placeholder: ${key}`);
    } else {
      oks.push(`OK ${key}`);
    }
  }

  const hasCronSecret = !missingOrPlaceholder(env.CRON_SECRET);
  const hasSyncSecret = !missingOrPlaceholder(env.DEMAND_ROUTES_SYNC_SECRET);
  if (!hasCronSecret && !hasSyncSecret) {
    warnings.push(
      'Neither CRON_SECRET nor DEMAND_ROUTES_SYNC_SECRET is configured (cron/admin automations may be exposed or disabled).'
    );
  } else {
    oks.push('OK cron authentication secret present');
  }

  const publicKeys = Object.keys(env).filter(
    (k) => k.startsWith('NEXT_PUBLIC_') || k.startsWith('EXPO_PUBLIC_')
  );
  const dangerousPublicPattern = /(SERVICE_ROLE|SECRET|PRIVATE|CRON_SECRET)/i;
  for (const key of publicKeys) {
    if (dangerousPublicPattern.test(key)) {
      errors.push(`Forbidden public env name: ${key}`);
    }
  }

  const requiredMobilePublic = [
    'EXPO_PUBLIC_SUPABASE_URL',
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    'EXPO_PUBLIC_API_BASE_URL',
  ];
  for (const key of requiredMobilePublic) {
    if (missingOrPlaceholder(env[key])) {
      warnings.push(`Missing or placeholder mobile public env: ${key}`);
    } else {
      oks.push(`OK ${key}`);
    }
  }

  console.log('=== Security Env Check ===');
  for (const line of oks) console.log(`  - ${line}`);
  if (warnings.length) {
    console.log('\nWarnings:');
    for (const line of warnings) console.log(`  - ${line}`);
  }
  if (errors.length) {
    console.log('\nErrors:');
    for (const line of errors) console.log(`  - ${line}`);
    console.log('\nResult: FAILED');
    process.exit(1);
  }
  if (strictMode && warnings.length) {
    console.log('\nResult: FAILED (strict mode)');
    process.exit(1);
  }
  console.log('\nResult: OK');
}

run();
