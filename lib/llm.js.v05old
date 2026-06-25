import { BASICS, PAIN_BUCKETS } from "./basics.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function requireEnv() {
  const key = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL_ID;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set.");
  if (!model) throw new Error("OPENROUTER_MODEL_ID is not set.");
  return { key, model };
}

async function callOpenRouter(messages, { maxTokens = 1500, temperature = 0.4 } = {}) {
  const { key, model } = requireEnv();
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-Title": "DRiX Channel Engine"
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || "";
  return content;
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
  return extractJson(out);
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
    `Tag each with pain (one of: ${PAIN_BUCKETS.join(", ")}), impact ('High'|'Medium'), and effort ('Quick'|'Moderate'|'Heavy').`,
    "",
    "Return ONLY a JSON object, no prose, no code fences:",
    '{"basics":[{"name":string,"applies":"Yes"|"No"|"Maybe","reason":string}],',
    '"advanced":[{"title":string,"problem":string,"solution":string,"pain":string,"impact":"High"|"Medium","effort":"Quick"|"Moderate"|"Heavy"}]}'
  ].join("\n");

  const user = [
    `Company: ${profile.name || "unknown"}`,
    `Vertical: ${profile.vertical || "unknown"}`,
    `Location: ${profile.location || "unknown"}`,
    profile.summary ? `What they do: ${profile.summary}` : "",
    profile.note ? `Extra context from partner: ${profile.note}` : ""
  ].filter(Boolean).join("\n");

  const out = await callOpenRouter(
    [{ role: "system", content: sys }, { role: "user", content: user }],
    { maxTokens: 2200, temperature: 0.5 }
  );
  const parsed = extractJson(out);
  // Defensive: force the fixed basics names/order regardless of model drift.
  const verdicts = Array.isArray(parsed.basics) ? parsed.basics : [];
  parsed.basics = BASICS.map((name, i) => {
    const v = verdicts[i] || {};
    return { name, applies: v.applies || "Maybe", reason: v.reason || "" };
  });
  parsed.advanced = Array.isArray(parsed.advanced) ? parsed.advanced.slice(0, 10) : [];
  return parsed;
}
