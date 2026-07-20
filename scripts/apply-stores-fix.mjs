#!/usr/bin/env node
/**
 * Apply the stores_public catalog fix to Mario's Supabase project.
 *
 * Needs ONE of:
 *   SUPABASE_ACCESS_TOKEN  — https://supabase.com/dashboard/account/tokens
 *   DATABASE_URL           — Settings → Database → URI connection string
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_... npm run db:fix-stores
 *   DATABASE_URL='postgresql://...' npm run db:fix-stores
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'ajkefntritjjynzofprq';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sqlPath = join(root, 'supabase', 'fix_stores_public.sql');
const sql = readFileSync(sqlPath, 'utf8');

async function viaManagementApi(token) {
  const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Management API ${res.status}: ${text}`);
  }
  console.log('Applied via Supabase Management API.');
  if (text) console.log(text.slice(0, 500));
}

async function viaDatabaseUrl(databaseUrl) {
  const postgres = (await import('postgres')).default;
  const sqlClient = postgres(databaseUrl, { max: 1, ssl: 'require' });
  try {
    await sqlClient.unsafe(sql);
    console.log('Applied via DATABASE_URL.');
  } finally {
    await sqlClient.end({ timeout: 5 });
  }
}

async function verify() {
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const base = process.env.VITE_SUPABASE_URL || `https://${PROJECT_REF}.supabase.co`;
  if (!anonKey) {
    console.log('Skip verify (VITE_SUPABASE_ANON_KEY not set).');
    return;
  }
  const res = await fetch(`${base}/rest/v1/stores_public?select=id,name&limit=5`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  });
  const data = await res.json();
  const count = Array.isArray(data) ? data.length : 0;
  console.log(`Verify stores_public => HTTP ${res.status}, sample rows: ${count}`);
  if (Array.isArray(data) && data.length) console.log(data);
  else if (res.ok) console.log('Still empty — check stores.is_active / suspended_at on the table.');
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

if (!token && !databaseUrl) {
  console.error(`No admin credentials in this environment.

App is already pointed at https://${PROJECT_REF}.supabase.co
(anon key works; auth health OK; menu_items readable).

To restore the restaurant catalog, provide ONE credential and re-run:

  export SUPABASE_ACCESS_TOKEN=sbp_...    # Account → Access Tokens
  npm run db:fix-stores

  # or
  export DATABASE_URL='postgresql://postgres:PASSWORD@db.${PROJECT_REF}.supabase.co:5432/postgres'
  npm run db:fix-stores

Or paste supabase/fix_stores_public.sql into the Supabase SQL Editor.`);
  process.exit(1);
}

try {
  if (token) await viaManagementApi(token);
  else await viaDatabaseUrl(databaseUrl);
  await verify();
} catch (err) {
  console.error(err?.message || err);
  process.exit(1);
}
