import { BASICS, PAIN_BUCKETS, EFFORT_BANDS } from "./basics.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function requireEnv() {
  const key = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL_ID;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set.");
  if (!model) throw new Error("OPENROUTER_MODEL_ID is not set.");
  return { key, model };
}

async function callOpenRouter(messages, { maxTokens = 1500, temperature = 0.4, plugins = null, online = false, timeoutMs = 0 } = {}) {
  const { key, model } = requireEnv();
  const useModel = online ? (model.includes(":online") ? model : model + ":online") : model;
  const ctrl = timeoutMs ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
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
      )),
      signal: ctrl ? ctrl.signal : undefined
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    const msg = data?.choices?.[0]?.message || {};
    return { content: msg.content || "", annotations: msg.annotations || [] };
  } finally {
    if (timer) clearTimeout(timer);
  }
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

export async function identifyCompany({ siteText, url, city }) {
  const sys = [
    "You read a company's website text and report, plainly, what the company does.",
    "Return ONLY JSON, no prose, no code fences:",
    '{"name": string, "vertical": string (the industry), "location": string (best guess city/region, or "unknown"), "summary": string (one or two plain sentences a human can confirm), "confidence": "high"|"medium"|"low"}'
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

// THE WATERFALL PRICING LOGIC
async function attemptPrice(sol, profile, online) {
  const band = EFFORT_BANDS[sol.effort] || EFFORT_BANDS.Moderate;
  const sys = [
    "You are a pricing analyst for ONE custom AI solution sold to a North American SMB in 2026.",
    online
      ? "Search the web for real market comparables for THIS specific build, then return ONE indicative TOTAL price range in USD for a one-year engagement."
      : "Reason ONE precise indicative TOTAL price range in USD for a one-year engagement from THIS build's real components.",
    "The range MUST be specific to THIS exact solution. Do NOT return a round generic band. Use realistic non-round figures (e.g. 21,500 - 37,000).",
    online
      ? "- If you find usable comparables: basis='market'; list the REAL https source URLs you used in sources (title + url)."
      : "- basis='scope'; leave sources empty.",
    `- Reference only: ${sol.effort || "Moderate"} effort usually lands somewhere around $${band.low}-$${band.high}. You MUST adjust away from those exact numbers for this specific solution.`,
    "Keep it sane for an SMB. Return ONLY JSON, no prose:",
    '{"low":number,"high":number,"basis":"market"|"scope","note":string,"sources":[{"title":string,"url":string}]}'
  ].join("\n");

  const user = [
    `Company: ${profile.name || "unknown"} | Vertical: ${profile.vertical || "unknown"}`,
    `Solution: ${sol.title}`,
    `What it does: ${sol.solution || sol.problem || ""}`,
    `Effort: ${sol.effort || "Moderate"} | Impact: ${sol.impact || "Medium"}`
  ].join("\n");

  try {
    const out = await callOpenRouter(
      [{ role: "system", content: sys }, { role: "user", content: user }],
      { maxTokens: 700, temperature: 0.55, online, timeoutMs: online ? 15000 : 22000 }
    );
    const clean = String(out.content).replace(/```json/gi, "").replace(/```/g, "").trim();
    const a = clean.indexOf("{"), b = clean.lastIndexOf("}");
    const row = JSON.parse(a !== -1 && b !== -1 ? clean.slice(a, b + 1) : clean);
    let low = Number(row.low), high = Number(row.high);
    if (!(Number.isFinite(low) && Number.isFinite(high) && low > 0 && high >= low)) return { valid: false };
    const wantMarket = row.basis === "market";
    const sources = (wantMarket && Array.isArray(row.sources))
      ? row.sources.filter(x => x && /^https?:\/\//i.test(String(x.url || "")))
      : [];
    return { valid: true, low, high, basis: (wantMarket && sources.length) ? "market" : "scope", note: row.note || "", sources };
  } catch (e) {
    return { valid: false };
  }
}

async function priceOneSolution(sol, profile) {
  // 1. Bulletproof the fallback so case-sensitivity never breaks the engine
  const eRaw = String(sol.effort || "").trim().toLowerCase();
  const band = (eRaw === "quick") ? EFFORT_BANDS.Quick : 
               (eRaw === "heavy") ? EFFORT_BANDS.Heavy : 
               EFFORT_BANDS.Moderate;

  // 2. Try the waterfall
  let r = await attemptPrice(sol, profile, true);
  if (!r.valid) r = await attemptPrice(sol, profile, false);
  
  // 3. Guaranteed fallback execution
  if (!r.valid) {
    return { low: band.low, high: band.high, basis: "scope", note: "Estimate from effort band.", sources: [] };
  }
  return r;
}

export async function priceSolutions({ solutions, profile }) {
  const list = Array.isArray(solutions) ? solutions.slice(0, 10) : [];
  const results = [];

  // FATAL FLAW FIX: Do not blast 10 concurrent web searches. 
  // Process them in batches of 3 so the API doesn't rate-limit you into a timeout.
  for (let i = 0; i < list.length; i += 3) {
    const chunk = list.slice(i, i + 3);
    const chunkRes = await Promise.all(chunk.map(sol => priceOneSolution(sol, profile)));
    results.push(...chunkRes);
  }

  const sources = [];
  const sourceKey = {};
  function refFor(src) {
    const url = (src && src.url) ? String(src.url).trim() : "";
    if (!/^https?:\/\//i.test(url)) return null;
    if (sourceKey[url]) return sourceKey[url];
    const n = sources.length + 1;
    sources.push({ n, title: String(src.title || url).slice(0, 140), url });
    sourceKey[url] = n;
    return n;
  }

  const priced = results.map(r => {
    const refs = r.basis === "market" ? r.sources.map(refFor).filter(Boolean) : [];
    const basis = refs.length ? "market" : "scope";
    return {
      low: r.low, high: r.high,
      monthlyLow: Math.round(r.low / 12),
      monthlyHigh: Math.round(r.high / 12),
      basis,
      refs,
      note: r.note || (basis === "scope" ? "Scope-based estimate." : "")
    };
  });

  return { priced, sources };
}

export async function analyzeCompany({ profile }) {
  const basicsList = BASICS.map((b, i) => `  (${i + 1}) ${b}`).join("\n");

  const sys = [
    "You are the DRiX Channel project engine. Given a confirmed company profile, return a structured JSON object with two generated tiers.",
    "TIER 1 — Business Basics. A FIXED checklist. The seven basics, verbatim and in order:",
    basicsList,
    "Return exactly these seven, in order, each with name (verbatim), applies = 'Yes' | 'No' | 'Maybe', and a one-line honest reason.",
    "TIER 2 — Advanced Solutions. Generate exactly 10 AI projects built specifically for this company. Rank by impact and achievability, strongest first.",
    `Tag each solution honestly. pain = one of: ${PAIN_BUCKETS.join(", ")}.`,
    "impact = 'High' | 'Medium' | 'Low'.",
    "effort = 'Quick' | 'Moderate' | 'Heavy'.",
    "Return ONLY a JSON object, no prose:",
    '{"basics":[{"name":string,"applies":"Yes"|"No"|"Maybe","reason":string}],',
    '"advanced":[{"title":string,"problem":string,"solution":string,"pain":string,"impact":"High"|"Medium"|"Low","effort":"Quick"|"Moderate"|"Heavy"}]}'
  ].join("\n");

  const user = [
    `Company: ${profile.name || "unknown"}`,
    `Vertical: ${profile.vertical || "unknown"}`,
    `Location: ${profile.location || "unknown"}`,
    profile.summary ? `What they do: ${profile.summary}` : "",
    profile.note ? `Extra context: ${profile.note}` : ""
  ].filter(Boolean).join("\n");

  const messages = [{ role: "system", content: sys }, { role: "user", content: user }];
  let out = await callOpenRouter(messages, { maxTokens: 8000, temperature: 0.5 });
  let parsed = tryExtractJson(out.content);
  if (!parsed) {
    out = await callOpenRouter(messages, { maxTokens: 8000, temperature: 0.5 });
    parsed = tryExtractJson(out.content);
  }
  if (!parsed) throw new Error("The analysis came back empty. Run it again.");
  
  const verdicts = Array.isArray(parsed.basics) ? parsed.basics : [];
  parsed.basics = BASICS.map((name, i) => {
    const v = verdicts[i] || {};
    return { name, applies: v.applies || "Maybe", reason: v.reason || "" };
  });
  parsed.advanced = Array.isArray(parsed.advanced) ? parsed.advanced.slice(0, 10) : [];
  return parsed;
}