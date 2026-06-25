// ============================================================================
//  DATA SEAM
//  Every save and lookup in the app goes through this module. Today it talks to
//  local/Railway Postgres. When you move to TDE, you rewrite THIS FILE ONLY and
//  keep the same exported function signatures. Nothing else in the app changes.
//
//  Exported contract (keep stable across the TDE swap):
//    init()
//    findCompanyByDomain(domain) -> company | null
//    upsertCompany(profile)      -> company
//    findRecentRunByCompany(companyId) -> run | null
//    saveRun({ companyId, partnerId, profile, basics, advanced }) -> run
//    findPartnerByDomain(domain) -> partner | null
// ============================================================================

import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS partners (
  id          SERIAL PRIMARY KEY,
  name        TEXT,
  domain      TEXT UNIQUE,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS companies (
  id          SERIAL PRIMARY KEY,
  domain      TEXT UNIQUE NOT NULL,
  name        TEXT,
  vertical    TEXT,
  location    TEXT,
  summary     TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runs (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  partner_id  INTEGER REFERENCES partners(id) ON DELETE SET NULL,
  profile     JSONB,
  basics      JSONB,
  advanced    JSONB,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_runs_company ON runs(company_id);
`;

export async function init() {
  await pool.query(SCHEMA);
}

export async function findCompanyByDomain(domain) {
  if (!domain) return null;
  const { rows } = await pool.query(`SELECT * FROM companies WHERE domain = $1`, [domain]);
  return rows[0] || null;
}

export async function upsertCompany(profile) {
  const { domain, name, vertical, location, summary } = profile;
  const { rows } = await pool.query(
    `INSERT INTO companies (domain, name, vertical, location, summary, updated_at)
     VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (domain) DO UPDATE SET
       name = EXCLUDED.name,
       vertical = EXCLUDED.vertical,
       location = EXCLUDED.location,
       summary = EXCLUDED.summary,
       updated_at = now()
     RETURNING *`,
    [domain, name || null, vertical || null, location || null, summary || null]
  );
  return rows[0];
}

export async function findRecentRunByCompany(companyId) {
  if (!companyId) return null;
  const { rows } = await pool.query(
    `SELECT * FROM runs WHERE company_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [companyId]
  );
  return rows[0] || null;
}

export async function saveRun({ companyId, partnerId, profile, basics, advanced }) {
  const { rows } = await pool.query(
    `INSERT INTO runs (company_id, partner_id, profile, basics, advanced)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [companyId, partnerId || null, profile || {}, JSON.stringify(basics || []), JSON.stringify(advanced || [])]
  );
  return rows[0];
}

export async function findPartnerByDomain(domain) {
  if (!domain) return null;
  const { rows } = await pool.query(`SELECT * FROM partners WHERE domain = $1`, [domain]);
  return rows[0] || null;
}
