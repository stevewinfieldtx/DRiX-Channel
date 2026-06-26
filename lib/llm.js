import { BASICS, PAIN_BUCKETS } from "./basics.js";

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

export async function generateSolutionDetail({ profile, solution }) {
  const sys = [
    "You are the DRiX Channel solution strategist. A channel partner is about to sell ONE specific AI solution to ONE specific customer.",
    "Turn the short solution card into a sales-ready brief the partner can walk in and teach from. Plain English, concrete, never generic.",
    "NEVER mention price, cost, budget, or dollar figures anywhere. This brief is about fit and outcomes, not money.",
    "Ground every section in THIS customer's vertical and the named pain.",
    "Return ONLY a JSON object, no prose, no code fences:",
    "{",
    '  "how_it_works": string (3-5 sentences expanding past the one-liner; what it actually does day to day),',
    '  "integrations": [string] (3-6 systems or data sources on the customer side this wires into, realistic for their vertical),',
    '  "why_this_customer": string (2-4 sentences tying it to their vertical and specific pain),',
    '  "discovery_questions": [string] (4-6 questions the partner asks to confirm the fit),',
    '  "objections": [{"objection": string, "response": string}] (exactly the 2 most likely pushbacks, each with a confident answer),',
    '  "pitch_line": string (one sentence the partner opens with),',
    '  "success_metric": string (the operational outcome that moves if this works; never a cost or price)',
    "}"
  ].join("\n");

  const user = [
    `Customer: ${profile.name || "unknown"}`,
    `Vertical: ${profile.vertical || "unknown"}`,
    `Location: ${profile.location || "unknown"}`,
    profile.summary ? `What they do: ${profile.summary}` : "",
    profile.note ? `Partner context: ${profile.note}` : "",
    "",
    `Solution title: ${solution.title || ""}`,
    `Problem it addresses: ${solution.problem || ""}`,
    `Solution summary: ${solution.solution || ""}`,
    solution.pain ? `Pain bucket: ${solution.pain}` : "",
    solution.impact ? `Impact: ${solution.impact}` : "",
    solution.effort ? `Effort: ${solution.effort}` : ""
  ].filter(Boolean).join("\n");

  const messages = [{ role: "system", content: sys }, { role: "user", content: user }];
  let out = await callOpenRouter(messages, { maxTokens: 1800, temperature: 0.5 });
  let parsed = tryExtractJson(out.content);
  if (!parsed) {
    out = await callOpenRouter(messages, { maxTokens: 1800, temperature: 0.5 });
    parsed = tryExtractJson(out.content);
  }
  if (!parsed) throw new Error("The deep dive came back empty. Open it again.");

  parsed.how_it_works = parsed.how_it_works || "";
  parsed.integrations = Array.isArray(parsed.integrations) ? parsed.integrations : [];
  parsed.why_this_customer = parsed.why_this_customer || "";
  parsed.discovery_questions = Array.isArray(parsed.discovery_questions) ? parsed.discovery_questions : [];
  parsed.objections = Array.isArray(parsed.objections) ? parsed.objections.slice(0, 2) : [];
  parsed.pitch_line = parsed.pitch_line || "";
  parsed.success_metric = parsed.success_metric || "";
  return parsed;
}

export async function analyzeCompany({ profile }) {
  const basicsList = BASICS.map((b, i) => `  (${i + 1}) ${b}`).join("\n");

  const sys = [
    "You are the DRiX Channel project engine. Given a confirmed company profile, you return a structured JSON object with two generated tiers.",
    "TIER 1 — Business Basics. A FIXED checklist. Do NOT invent, add, remove, or reword. Decide, for THIS company's industry, whether each applies. The seven basics, verbatim and in order:",
    basicsList,
    "Return exactly these seven, in order, each with name (verbatim), applies = 'Yes' | 'No' | 'Maybe', and a one-line honest reason.",
    "TIER 2 — Advanced Solutions. Generate exactly 10 AI projects built specifically for this company. Rank by impact and achievability, strongest first.",
    `Tag each solution honestly. pain = one of: ${PAIN_BUCKETS.join(", ")}.`,
    "impact = 'High' | 'Medium' | 'Low'.",
    "effort = 'Quick' | 'Moderate' | 'Heavy'.",
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