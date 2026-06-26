import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";

import * as store from "./db/index.js";
import { fetchSiteText, normalizeUrl, domainOf } from "./lib/siteReader.js";
import { identifyCompany, analyzeCompany, priceSolutions } from "./lib/llm.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Initialize Supabase Client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// ---- SUPABASE AUTH MIDDLEWARE ----
// Decodes and verifies the incoming Supabase JWT token natively
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: "Access denied. Login required." });

  // Natively verify using Supabase's project JWT secret
  jwt.verify(token, process.env.SUPABASE_JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ error: "Session expired or invalid token." });
    
    // Supabase stores the unique user UUID inside the token 'sub' claim
    req.user = { id: decoded.sub, email: decoded.email };
    next();
  });
}

// Optional Auth: Links tracking data to history if user is logged in, but allows guests
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return next();

  jwt.verify(token, process.env.SUPABASE_JWT_SECRET, (err, decoded) => {
    if (!err && decoded) {
      req.user = { id: decoded.sub, email: decoded.email };
    }
    next();
  });
}

// ---- PLATFORM HISTORY ROUTE ----
app.get("/api/history", authenticateToken, async (req, res) => {
  try {
    const history = await store.getUserHistory(req.user.id);
    return res.json({ history });
  } catch (err) {
    console.error("History endpoint error:", err);
    res.status(500).json({ error: "Failed to compile user profile history." });
  }
});

// ---- CORE ENGINE ROUTES ----
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    model: process.env.OPENROUTER_MODEL_ID || null,
    hasKey: Boolean(process.env.OPENROUTER_API_KEY),
    hasDb: Boolean(process.env.DATABASE_URL)
  });
});

app.post("/api/identify", async (req, res) => {
  try {
    const url = normalizeUrl(req.body?.url);
    const city = (req.body?.city || "").trim();
    if (!url) return res.status(400).json({ error: "Enter a valid company URL." });

    const domain = domainOf(url);
    let cached = null;
    try {
      const company = await store.findCompanyByDomain(domain);
      if (company) {
        const lastRun = await store.findRecentRunByCompany(company.id);
        cached = { company, lastRun };
      }
    } catch (e) {
      console.warn("cache lookup failed:", e.message);
    }

    if (cached) {
      return res.json({
        known: true,
        domain,
        profile: {
          name: cached.company.name,
          vertical: cached.company.vertical,
          location: cached.company.location,
          summary: cached.company.summary
        },
        lastRunAt: cached.lastRun?.created_at || null,
        source: "cache"
      });
    }

    const site = await fetchSiteText(url);
    const profile = await identifyCompany({ siteText: site.text, url, city });
    if (!profile.location || profile.location === "unknown") {
      if (city) profile.location = city;
    }

    return res.json({
      known: false,
      domain,
      profile,
      siteRead: site.ok,
      siteNote: site.ok ? null : site.error,
      source: "fresh"
    });
  } catch (err) {
    console.error("identify error:", err);
    return res.status(500).json({ error: err.message || "Identify failed." });
  }
});

app.post("/api/analyze", optionalAuth, async (req, res) => {
  try {
    const url = normalizeUrl(req.body?.url);
    const profile = req.body?.profile || {};
    const partnerDomain = (req.body?.partnerDomain || "").trim();
    if (!url) return res.status(400).json({ error: "Missing company URL." });
    if (!profile.vertical && !profile.summary) {
      return res.status(400).json({ error: "Confirm the company profile before running." });
    }
    const domain = domainOf(url);

    const result = await analyzeCompany({ profile });

    let saved = null;
    try {
      const company = await store.upsertCompany({ domain, ...profile });
      let partnerId = null;
      if (partnerDomain) {
        const partner = await store.findPartnerByDomain(domainOf(normalizeUrl(partnerDomain)) || partnerDomain);
        partnerId = partner?.id || null;
      }
      
      const userId = req.user ? req.user.id : null;

      saved = await store.saveRun({
        companyId: company.id,
        partnerId,
        userId,
        profile,
        basics: result.basics,
        advanced: result.advanced
      });
    } catch (e) {
      console.warn("save run failed:", e.message);
    }

    return res.json({ ...result, savedRunId: saved?.id || null });
  } catch (err) {
    console.error("analyze error:", err);
    return res.status(500).json({ error: err.message || "Analysis failed." });
  }
});

app.post("/api/price", async (req, res) => {
  try {
    const profile = req.body?.profile || {};
    const solutions = Array.isArray(req.body?.solutions) ? req.body.solutions : [];
    if (!solutions.length) return res.status(400).json({ error: "No solutions to price." });

    const payload = await priceSolutions({ solutions, profile });
    return res.json(payload);
  } catch (err) {
    console.error("pricing route error:", err);
    return res.status(500).json({ error: err.message || "Pricing compilation failed." });
  }
});

const PORT = process.env.PORT || 3000;

store.init()
  .then(() => console.log("DB ready"))
  .catch((e) => console.warn("DB init skipped/failed (app still serves):", e.message))
  .finally(() => {
    app.listen(PORT, () => console.log(`DRiX Channel Engine on :${PORT}`));
  });