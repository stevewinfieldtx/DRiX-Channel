import { BASICS, PAIN_BUCKETS, EFFORT_BANDS } from "./basics.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function requireEnv() {
  const key = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL_ID;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set.");
  if (!model) throw new Error("OPENROUTER_MODEL_ID is not set.");
  return { key, model };
}

async function callOpenRouter(messages, { maxTokens = 1500, temperature = 0.4, plugins = null, online = false } = {}) {
  const { key, model } = requireEnv();
  const useModel = online ? (model.includes(":online") ? model : model + ":online") : model;
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-Title": "DRiX Channel Engine"
    },
    body: JSON.stringify(Object.assign(
      { model: useModel, messages, max_tokens: maxTokens, temperature },
      plugins ? { plugins } : {}
    ))
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const msg = data?.choices?.[0]?.message || {};
  return { content: msg.content || "", annotations: msg.annotations || [] };
}

function tryExtractJson(text) {
  try { return extractJson(text); } catch (e) { return null; }
}

function extractJson(text) {
  let clean = String(text).replace(/```json/gi, "").replace(/```/g, "").trim();
  const firstObj = clean.indexOf("{");
  const lastObj = clean.lastIndexOf("}");
  if (firstObj !== -1 && lastObj !== -1) clean = clean.slice(firstObj, lastObj + 1);
  return JSON.parse(clean);
}

// STEP 1 — read the site, tell us what the company does, so the user can confirm.
export async function identifyCompany({ siteText, url, city }) {
  const sys = [
    "You read a company's website text and report, plainly, what the company does.",
    "Return ONLY JSON, no prose, no code fences:",
    '{"name": string, "vertical": string (the industry, e.g. "water/fire restoration", "commercial HVAC"), "location": string (best guess city/region, or "unknown"), "summary": string (one or two plain sentences a human can confirm), "confidence": "high"|"medium"|"low"}'
  ].join("\n");

  const user = [
    `Company URL: ${url}`,
    city ? `User-provided city (HQ / location hint): ${city}` : "",
    "",
    "Website text:",
    siteText || "(no readable text was retrieved)"
  ].filter(Boolean).join("\n");

  const out = await callOpenRouter(
    [{ role: "system", content: sys }, { role: "user", content: user }],
    { maxTokens: 500, temperature: 0.2 }
  );
  const profile = tryExtractJson(out.content);
  if (profile) return profile;
  return { name: "", vertical: "", location: city || "unknown",
           summary: "We could not read this site cleanly. Add the vertical and a line of context below.",
           confidence: "low" };
}

// STEP 3 — indicative pricing per solution, market-searched with citations,
// falling back to effort bands (clearly labeled) when the search comes up thin.
export async function priceSolutions({ solutions, profile }) {
  const list = solutions.map((x, i) =>
    `${i}. ${x.title} | effort: ${x.effort || "Moderate"} | ${x.problem || ""}`
  ).join("\n");

  const bandText = Object.entries(EFFORT_BANDS)
    .map(([k, v]) => `${k}: $${v.low}-$${v.high}`).join("; ");

  const sys = [
    "You are a pricing analyst for custom AI solutions sold to North American SMBs in 2026.",
    "For EACH solution, search the web for real market comparables for that TYPE of build at that effort level, and return an INDICATIVE total price range in USD for a one-year engagement (total contract value, not monthly).",
    "Rules:",
    "- If you find usable market comparables, set basis to 'market', set low/high from them, and list the real source URLs you actually used in sources (title + url). Only real URLs.",
    "- If you cannot find usable comparables for a solution, set basis to 'effort', use the fallback band for that solution's effort level, leave sources empty, and say so in note.",
    `- Fallback effort bands (USD total): ${bandText}.`,
    "- Keep ranges sane for an SMB. These are indicative budgeting figures, not quotes.",
    "Return ONLY a JSON array, one object per solution in the same order, no prose, no code fences:",
    '[{"index":number,"low":number,"high":number,"basis":"market"|"effort","note":string,"sources":[{"title":string,"url":string}]}]'
  ].join("\n");

  const user = [
    `Vertical: ${profile.vertical || "unknown"}`,
    profile.summary ? `Business: ${profile.summary}` : "",
    "",
    "Solutions to price:",
    list
  ].filter(Boolean).join("\n");

  let parsed = [];
  let annotations = [];
  try {
    const out = await callOpenRouter(
      [{ role: "system", content: sys }, { role: "user", content: user }],
      { maxTokens: 2600, temperature: 0.3, online: true }
    );
    annotations = out.annotations || [];
    const clean = String(out.content).replace(/```json/gi, "").replace(/```/g, "").trim();
    const a = clean.indexOf("["), b = clean.lastIndexOf("]");
    parsed = JSON.parse(a !== -1 && b !== -1 ? clean.slice(a, b + 1) : clean);
    if (!Array.isArray(parsed)) parsed = [];
  } catch (e) {
    parsed = [];
  }

  // Assemble per-solution pricing with an effort-band fallback for any gap.
  const sources = [];
  const sourceKey = {};
  function refFor(src) {
    const url = (src && src.url) ? src.url.trim() : "";
    if (!/^https?:\/\//i.test(url)) return null;
    if (sourceKey[url]) return sourceKey[url];
    const n = sources.length + 1;
    sources.push({ n, title: (src.title || url).slice(0, 140), url });
    sourceKey[url] = n;
    return n;
  }

  const priced = solutions.map((sol, i) => {
    const band = EFFORT_BANDS[sol.effort] || EFFORT_BANDS.Moderate;
    const row = parsed.find(r => Number(r.index) === i) || parsed[i] || {};
    let low = Number(row.low), high = Number(row.high);
    let basis = row.basis === "market" ? "market" : "effort";
    let refs = [];

    const valid = Number.isFinite(low) && Number.isFinite(high) && low > 0 && high >= low;
    if (basis === "market" && valid && Array.isArray(row.sources) && row.sources.length) {
      refs = row.sources.map(refFor).filter(Boolean);
      if (!refs.length) { basis = "effort"; }  // market claim with no real source -> demote
    }
    if (basis === "effort" || !valid) {
      low = band.low; high = band.high; basis = "effort"; refs = [];
    }

    return {
      low, high,
      monthlyLow: Math.round(low / 12),
      monthlyHigh: Math.round(high / 12),
      basis,                       // "market" (cited) or "effort" (scope-based)
      refs,                        // citation numbers into the appendix
      note: row.note || (basis === "effort" ? "Scope-based estimate. No market match found." : "")
    };
  });

  return { priced, sources };
}

// STEP 2 — the three-tier analysis, read through the dimension lens.
export async function analyzeCompany({ profile }) {
  const basicsList = BASICS.map((b, i) => `  (${i + 1}) ${b}`).join("\n");

  const sys = [
    "You are the DRiX Channel project engine. Given a confirmed company profile, you return a structured JSON object with two generated tiers. A third tier (custom integration) is intentionally NOT generated here.",
    "",
    "Decompose the company through this lens before answering (these dimensions inform your judgment; you do not output them directly): sales-cycle stage, role, recency, business function, temperature, AI readiness, pain type, urgency, impact, effort.",
    "",
    "TIER 1 — Business Basics. A FIXED checklist. Do NOT invent, add, remove, or reword. Decide, for THIS company's industry, whether each applies. The seven basics, verbatim and in order:",
    basicsList,
    "Return exactly these seven, in order, each with name (verbatim), applies = 'Yes' | 'No' | 'Maybe', and a one-line honest reason. Be willing to say No. Do not force a fit.",
    "",
    "TIER 2 — Advanced Solutions. Generate exactly 10 AI projects built specifically for this company. Attack the real operational bottlenecks of its industry. Favor visibility, communication, speed-to-paid, prediction, and retention over fighting entrenched category-leading software on its home turf. Rank by impact and achievability, strongest first. Each must feel specific enough that an insider thinks 'they get my business.'",
    `Tag each solution honestly and use the FULL range on both axes. Do not default everything to Medium or Moderate.`,
    `pain = one of: ${PAIN_BUCKETS.join(", ")}.`,
    "impact = 'High' | 'Medium' | 'Low', by the real revenue or operational effect for THIS business.",
    "effort = 'Quick' | 'Moderate' | 'Heavy', by genuine build complexity: Quick = one simple agent, little or no integration; Moderate = a few integrations or custom logic; Heavy = many systems, deep data work, or complex orchestration.",
    "Across the ten, expect a realistic spread of impact AND effort, not one value repeated.",
    "",
    "Return ONLY a JSON object, no prose, no code fences:",
    '{"basics":[{"name":string,"applies":"Yes"|"No"|"Maybe","reason":string}],',
    '"advanced":[{"title":string,"problem":string,"solution":string,"pain":string,"impact":"High"|"Medium"|"Low","effort":"Quick"|"Moderate"|"Heavy"}]}'
  ].join("\n");

  const user = [
    `Company: ${profile.name || "unknown"}`,
    `Vertical: ${profile.vertical || "unknown"}`,
    `Location: ${profile.location || "unknown"}`,
    profile.summary ? `What they do: ${profile.summary}` : "",
    profile.note ? `Extra context from partner: ${profile.note}` : ""
  ].filter(Boolean).join("\n");

  const messages = [{ role: "system", content: sys }, { role: "user", content: user }];
  let out = await callOpenRouter(messages, { maxTokens: 2200, temperature: 0.5 });
  let parsed = tryExtractJson(out.content);
  if (!parsed) {
    // one retry before giving up — empty/garbled model output should not crash the run
    out = await callOpenRouter(messages, { maxTokens: 2200, temperature: 0.5 });
    parsed = tryExtractJson(out.content);
  }
  if (!parsed) throw new Error("The analysis came back empty. Run it again.");
  // Defensive: force the fixed basics names/order regardless of model drift.
  const verdicts = Array.isArray(parsed.basics) ? parsed.basics : [];
  parsed.basics = BASICS.map((name, i) => {
    const v = verdicts[i] || {};
    return { name, applies: v.applies || "Maybe", reason: v.reason || "" };
  });
  parsed.advanced = Array.isArray(parsed.advanced) ? parsed.advanced.slice(0, 10) : [];

  // Attach indicative pricing (market-searched with citations, effort-band fallback).
  try {
    const { priced, sources } = await priceSolutions({ solutions: parsed.advanced, profile });
    parsed.advanced = parsed.advanced.map((sol, i) => Object.assign({}, sol, { price: priced[i] || null }));
    parsed.priceSources = sources;
  } catch (e) {
    parsed.priceSources = [];
  }
  return parsed;
}
