import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as store from "./db/index.js";
import { fetchSiteText, normalizeUrl, domainOf } from "./lib/siteReader.js";
import { identifyCompany, analyzeCompany, priceSolutions } from "./lib/llm.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---- health ----
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    model: process.env.OPENROUTER_MODEL_ID || null,
    hasKey: Boolean(process.env.OPENROUTER_API_KEY),
    hasDb: Boolean(process.env.DATABASE_URL)
  });
});

// ---- STEP 1: identify ----
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

// ---- STEP 2: analyze ----
app.post("/api/analyze", async (req, res) => {
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
      saved = await store.saveRun({
        companyId: company.id,
        partnerId,
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

// ---- STEP 3: price ----
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