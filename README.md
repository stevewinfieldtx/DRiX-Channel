# DRiX Channel — Engine

**UNZIP PLACEMENT: extract so that `server.js`, `package.json`, and the `public/`, `db/`, and `lib/` folders all sit together at the project root. Do not nest them inside an extra folder. The whole thing is one Railway service.**

URL-first, three-tier AI-fit engine for the channel play.
Paste a company URL → it reads the site → confirm what they do → it runs:

1. **Business Basics** — the locked seven, qualified Yes/No/Maybe for that industry.
2. **Advanced Solutions** — ten builds scoped to that company, ranked by impact.
3. **Custom Integration** — locked. Generates nothing. Points to the partner conversation.

Built standalone on Postgres for now. **It ports to TDE by rewriting one file: `db/index.js`.** Nothing else changes.

---

## Run locally

```bash
npm install
cp .env.example .env        # then fill in the values
npm run check               # node --check server.js
npm start                   # http://localhost:3000
```

Requires Node 18+ (uses global fetch) and a reachable Postgres in `DATABASE_URL`.

## Environment

| var | required | notes |
|---|---|---|
| `OPENROUTER_API_KEY` | yes | never hardcode |
| `OPENROUTER_MODEL_ID` | yes | e.g. `anthropic/claude-sonnet-4.5` |
| `DATABASE_URL` | yes | Railway injects this automatically |
| `DATABASE_SSL` | no | `true` if your Postgres needs SSL (most external/managed). Railway internal usually does not. |
| `PORT` | no | Railway injects it; local defaults to 3000 |

## Deploy to Railway

1. Push this folder to a Git repo.
2. New Railway project → Deploy from repo.
3. Add the **Postgres** plugin → `DATABASE_URL` appears automatically.
4. Set `OPENROUTER_API_KEY` and `OPENROUTER_MODEL_ID` in service variables.
5. Deploy. Start command is `npm start`. Tables auto-create on first boot.

`GET /api/health` confirms key + model + db wiring.

## The TDE swap (later)

Everything persistent goes through `db/index.js`. When TDE is ready, rewrite that one
module to read/write TDE instead of Postgres, keep the same exported function names,
and the rest of the app is untouched. The basics list and the decomposition dimensions
live in `lib/basics.js`.

## Known v1 limits

- The site reader is a plain server-side fetch. Heavy client-rendered SPAs may return
  little text; the confirm screen lets you correct the vertical and add context by hand.
- Partner attribution table exists (`partners`) and the seam supports it, but there's no
  partner UI yet — wire it when the rev-share flow is real.

## Indicative pricing layer (v0.7)

Each Advanced solution now carries an indicative price range.

- **Market-based:** a web-search step (OpenRouter `web` plugin, using your `OPENROUTER_MODEL_ID`) finds 2026 North American SMB comparables for that solution type and effort, and the card cites the real sources. Sources collect into a **Pricing references** appendix at the bottom of the report.
- **Scope-based fallback:** if the search returns nothing usable, the card falls back to the effort band in `lib/basics.js` (`EFFORT_BANDS`) and is plainly labeled "Scope-based," with no market citation.
- **Math:** range shown is total one-year contract value. Monthly = total / 12. Setup = one month.
- **Honesty:** every figure is indicative for budgeting only. A firm number is set after scoping the customer's real environment, outside the engine.

Recalibrate the three `EFFORT_BANDS` against real closes. They are rough anchors, not gospel.

Note: the `web` plugin requires the configured model/account to support OpenRouter web search. If it does not, pricing degrades gracefully to scope-based bands.
