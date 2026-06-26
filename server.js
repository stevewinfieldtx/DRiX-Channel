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

// Bypassed for local development so local firewalls don't kill the socket
async function withHeartbeat(res, task) {
  try {
    const payload = await task();
    res.json(payload);
  } catch (err) {
    console.error("Task error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err?.message || "Request failed." });
    }
  }
}

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

app.post("/api/analyze", async (req, res) => {
  const url = normalizeUrl(req.body?.url);
  const profile = req.body?.profile || {};
  const partnerDomain = (req.body?.partnerDomain || "").trim();
  if (!url) return res.status(400).json({ error: "Missing company URL." });
  if (!profile.vertical && !profile.summary) {
    return res.status(400).json({ error: "Confirm the company profile before running." });
  }
  const domain = domainOf(url);

  await withHeartbeat(res, async () => {
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
    return { ...result, savedRunId: saved?.id || null };
  });
});

app.post("/api/price", async (req, res) => {
  const profile = req.body?.profile || {};
  const solutions = Array.isArray(req.body?.solutions) ? req.body.solutions : [];
  if (!solutions.length) return res.status(400).json({ error: "No solutions to price." });

  await withHeartbeat(res, async () => {
    const { priced, sources } = await priceSolutions({ solutions, profile });
    return { priced, sources };
  });
});

const PORT = process.env.PORT || 3000;

store.init()
  .then(() => console.log("DB ready"))
  .catch((e) => console.warn("DB init skipped/failed:", e.message))
  .finally(() => {
    app.listen(PORT, () => console.log(`DRiX Channel Engine on :${PORT}`));
  });