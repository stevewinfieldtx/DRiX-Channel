// Fetches a company homepage and returns stripped text for the LLM to read.
// v1: plain server-side fetch. Heavy client-rendered SPAs may return little text;
// the UI provides a manual description fallback for those cases.

export function normalizeUrl(raw) {
  if (!raw) return null;
  let u = String(raw).trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try {
    const parsed = new URL(u);
    return parsed.href;
  } catch {
    return null;
  }
}

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

export async function fetchSiteText(url, { timeoutMs = 10000, maxChars = 7000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DRiXChannelEngine/0.5; +https://drix.ai)",
        "Accept": "text/html,application/xhtml+xml"
      }
    });
    clearTimeout(t);
    if (!res.ok) return { ok: false, error: `Site responded ${res.status}`, text: "" };

    const ctype = res.headers.get("content-type") || "";
    if (!/text\/html|xml|text\/plain/i.test(ctype)) {
      return { ok: false, error: `Unsupported content type (${ctype})`, text: "" };
    }

    const html = await res.text();
    const text = stripHtml(html).slice(0, maxChars);
    if (text.trim().length < 40) {
      return { ok: false, error: "Page returned almost no readable text (likely a client-rendered app).", text };
    }
    return { ok: true, text, error: null };
  } catch (err) {
    clearTimeout(t);
    const msg = err.name === "AbortError" ? "Site took too long to respond." : (err.message || "Could not reach the site.");
    return { ok: false, error: msg, text: "" };
  }
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
