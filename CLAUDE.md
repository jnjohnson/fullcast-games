# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Vite dev server with HMR (runs the Worker via @cloudflare/vite-plugin)
npm run build      # Production build
npm run preview    # Build + wrangler dev
npm run deploy     # Build + deploy to Cloudflare Workers
npm test           # Vitest (runs inside the Workers runtime via @cloudflare/vitest-pool-workers)
```

## Architecture

Full-stack app on **Cloudflare Workers** with a **Vue 3 SPA** frontend. All player data comes live from the **College Football Data (CFBD) GraphQL API**. There is no database. **Cloudflare KV** (`CFBD_CACHE` binding) is used for short-lived caching.

### Server (`server/`)

- **`index.js`**: Worker entry point. Routes by pathname:
  - `GET  /api/transfer-wizard/get-players?difficulty=` → `getPlayers`
  - `POST /api/transfer-wizard/submit` → `checkAnswer`
  - `GET  /api/guys/random-player` → `getRandomPlayer` (filter query params, see below)
  - `GET  /api/guys/player?playerId=` → `getPlayerById`
  - `GET  /api/guys/player-stats` → `getPlayerStats`
  - `GET  /api/guys/videos?firstName=&lastName=&position=` → `getPlayerHighlights`
  - Anything else → 404
- **`cfbd.js`**: `cfbdGql(query, variables, env)` POSTs to `https://graphql.collegefootballdata.com/v1/graphql`. It returns `data` and throws on HTTP or GraphQL errors. The schema is Hasura-style (`where` with `_eq` / `_in`, `orderBy`, `*Aggregate`).
- **`kv.js`**: `kvGet` / `kvPut` JSON helpers for `CFBD_CACHE` (1-hour TTL).
- **`transferWizard.js`**: Transfer Wizard game logic (see Game Flow).
- **`guys.js`**: Guys page logic:
  - `getRandomPlayer(request, env)` reads the filters with `searchParams.getAll()` for `position`, `school`, `conference`, and `year`, so a key may repeat (e.g. `?position=QB&position=WR`). It builds an `athlete_bool_exp` `where` clause using `_in`, counts the matches with `athleteAggregate`, then picks a random offset. It retries until it finds a player with stats. Returns 404 `{ error }` if nothing matches.
  - `getPlayerById` returns the same `{ player, stats }` shape as `getRandomPlayer`.
  - `getPlayerStats(playerId, env)` takes a **numeric ID**, not a Request. It returns the stat map directly: `{ [category]: { statNames: [], seasons: [{ season, team, stats: {} }] } }`. It sums per-game `gamePlayerStat` rows into season totals and computes AVG, FG %, and XP %.
  - `getPlayerHighlights` wraps `youtube.js`.
- **`youtube.js`**: `getPlayerVideos()` searches YouTube Data API v3 for 4 highlight videos. Results are cached in KV under `yt:First_Last_POS` for 24h.

### Frontend (`src/`)

- **`router/index.js`**: `/` (HomeView), `/transfer-wizard`, `/guys` (both lazy-loaded).
- **`views/TransferWizard.vue`**: Shows a transfer route and 4 player buttons, then POSTs the answer and animates correct (green) or incorrect (red).
- **`views/Guys.vue`**: "Remember A Guy" random player lookup.
  - Filters are driven by the `FILTER_DEFS` array (`position`, `school`, `conference`, `year`), which renders one custom checkbox dropdown per filter in a `v-for` loop. Option lists (`POSITIONS`, `SCHOOLS`, `CONFERENCES`, `YEARS`) are hardcoded constants. `SCHOOLS` names must match CFBD `team.school` values exactly.
  - Each dropdown trigger shows the current selections, comma-separated. `formatYearChips` collapses consecutive years into ranges (e.g. `2012 - 2018`).
  - School and conference are mutually exclusive: selecting one disables the other (`isFilterDisabled`).
  - `toggleFilter` opens one dropdown and closes the rest. A document click listener (`onDocClick` with `groupRefs`) closes dropdowns when the user clicks outside them.
  - The Reset button calls `reset()`, which clears the filters, player, stats, videos, and the `?playerId=` query param.
  - Loading a player writes `?playerId=` to the URL, so a player can be shared by link. On mount, the page loads that player if the param is present.
  - The page shows a stats table per category and embedded YouTube highlight iframes.
- **`assets/base.scss`**: Global SCSS variables (dark theme, cyan `$ptku-blue` `#50EFEC` primary, magenta `$ptku-pink` `#D12CDC` secondary).
- **`assets/main.scss`**: Global button styles. `.button-alternate` is the magenta secondary button.

## Game Flow (Transfer Wizard)

1. `get-players` asks CFBD `transfer` for up to 50 transfers matching the difficulty, then picks 4 at random:
   - `easy`: 2026 QBs to a random set of P4 schools
   - `medium`: 2026 QB/RB/WR
   - `hard`: QB/RB/WR, any season
   - `sickos`: no filter (the default)
2. For each candidate, it fetches that player's full transfer history. `buildTransferChain` turns it into a list of stops and handles several edge cases: duplicate destinations, null destinations, and gaps where `fromTeam` doesn't match the previous `toTeam`. The first candidate whose chain is playable becomes the question.
3. The correct player is cached in KV, keyed by `JSON.stringify(question)`. The response is `{ question, players: [{ name, id }] }`, where each `id` is `First_Last_POS`.
4. `submit` POSTs `{ question }`. The server looks up the cached answer and returns `{ pid: [id] }`, or 404 if the cache entry has expired.

## Testing

Tests live in `test/` and run in the Workers runtime. The convention is:
- Mock `../server/cfbd.js` with `vi.mock` and stub `cfbdGql` responses in the order the function under test calls it. For example, `getRandomPlayer` makes three calls: count, then athlete, then gamePlayerStat.
- Import the handlers directly.
- For routing tests, call `worker.fetch(new Request(...), env)` using the default export of `server/index.js`. Don't fetch a live server.

## Environment Variables

Set these in `.dev.vars` for local dev and as Cloudflare secrets in production:
- `CFBD_TOKEN`: the `Authorization` header value for the CFBD API (e.g. `Bearer ...`).
- `YOUTUBE_API_KEY`: the YouTube Data API v3 key.