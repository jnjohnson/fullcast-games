# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Vite dev server with HMR
npm run build      # Production build
npm run preview    # Preview build via wrangler dev
npm run deploy     # Build + deploy to Cloudflare Workers

# D1 database
npx wrangler d1 execute games-db --command "SELECT ..."         # Remote DB
npx wrangler d1 execute games-db --command "SELECT ..." --local # Local DB

# Test cron job (run both commands)
npx wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled"
```

## Architecture

Full-stack app on **Cloudflare Workers** with a **Vue 3 SPA** frontend.

- **`server/index.js`** — Worker entry point. Routes `GET /api/transfer-wizard/get-players` and `POST /api/transfer-wizard/submit` to handler functions. The `scheduled` handler runs every Sunday at midnight (cron `0 0 * * sun`) to sync transfer portal data from the College Football Data API into D1.
- **`server/transferWizard.js`** — Business logic: selects 4 random players from D1, validates answers, and upserts player transfer records during the weekly sync.
- **`src/views/TransferWizard.vue`** — Primary game UI. Fetches a question on mount, shows 4 player choices as buttons, POSTs the answer, and applies correct/incorrect animations. Multiple players can share the same transfer route, so the submit endpoint returns an array of correct player IDs.
- **`src/assets/base.scss`** — Global SCSS variables (dark theme, cyan `#50EFEC` primary, magenta `#D12CDC` secondary).

## Database Schema

`PlayerTransfers` table in Cloudflare D1 (`games-db`):

| Column | Type | Notes |
|--------|------|-------|
| `PlayerId` | INTEGER PK | |
| `FirstName` | TEXT | |
| `LastName` | TEXT | |
| `Position` | TEXT | |
| `WasInP4` | INTEGER | 0/1 — started at Power 4 school |
| `InP4` | INTEGER | 0/1 — currently at Power 4 school |
| `Transfers` | TEXT | JSON array of school names, e.g. `["New Mexico","UTSA"]` |

Indexed on `(FirstName, LastName, Position)`.

## Game Flow

1. `GET /api/transfer-wizard/get-players` returns a random transfer route (multi-school JSON array) and 4 random player names/IDs.
2. Player picks one of the 4 buttons; the selection POSTs to `/api/transfer-wizard/submit` with the question array.
3. Server queries all players whose `Transfers` JSON matches, returning an array of correct IDs.
4. Correct selections animate green; incorrect animate red and reveal the correct answer(s).

## Environment Variables

- `CFBD_TOKEN` — Authorization header value for the College Football Data API (set in `.env` locally, Cloudflare secrets in production).
