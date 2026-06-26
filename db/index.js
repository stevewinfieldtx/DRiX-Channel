import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  console.error('Postgres Pool Error:', err.message);
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
  user_id     UUID, -- Stores the secure unique UUID straight from Supabase Auth
  profile     JSONB,
  basics      JSONB,
  advanced    JSONB,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_runs_company ON runs(company_id);
CREATE INDEX IF NOT EXISTS idx_runs_user ON runs(user_id);

-- Safely patch the table if user_id doesn't exist or needs to accept UUIDs
ALTER TABLE runs ADD COLUMN IF NOT EXISTS user_id UUID;
`;

export async function init() {
  await pool.query(SCHEMA);
}

export async function getUserHistory(userId) {
  const { rows } = await pool.query(
    `SELECT r.id, r.created_at, c.name as company_name, c.domain as company_domain 
     FROM runs r 
     JOIN companies c ON r.company_id = c.id 
     WHERE r.user_id = $1 
     ORDER BY r.created_at DESC`,
    [userId]
  );
  return rows;
}

// ---- CORE ENGINE SEAM ----
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

export async function saveRun({ companyId, partnerId, userId, profile, basics, advanced }) {
  const { rows } = await pool.query(
    `INSERT INTO runs (company_id, partner_id, user_id, profile, basics, advanced)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [companyId, partnerId || null, userId || null, profile || {}, JSON.stringify(basics || []), JSON.stringify(advanced || [])]
  );
  return rows[0];
}

export async function findPartnerByDomain(domain) {
  if (!domain) return null;
  const { rows } = await pool.query(`SELECT * FROM partners WHERE domain = $1`, [domain]);
  return rows[0] || null;
}