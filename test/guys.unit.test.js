import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { syncPlayers, getRandomPlayer, getPlayerStats } from "../server/guys.js";

// Returns a chainable mock DB whose sequential run() calls return the given values.
// Supports both prepare().run() and prepare().bind().run() call patterns.
function makeDb(...runResults) {
    let callIndex = 0;
    const run = vi.fn(() =>
        Promise.resolve(runResults[callIndex++] ?? { results: [] })
    );
    const bind = vi.fn(() => ({ run }));
    const stmt = { bind, run };
    const db = { prepare: vi.fn(() => stmt) };
    return { db, stmt, bind, run };
}

function makeRequest(path) {
    return new Request(`http://fake-host${path}`);
}

// ─── syncPlayers ────────────────────────────────────────────────────────────

describe("syncPlayers", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("logs an error and returns early when the roster fetch fails", async () => {
        fetch.mockResolvedValue({ ok: false, status: 500 });
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const { db } = makeDb();
        await syncPlayers({ games_db: db });
        expect(db.prepare).not.toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    it("skips players missing id or team", async () => {
        const players = [
            { first_name: "No", last_name: "Id", position: "QB", team: "Alabama" },
            { id: 99, first_name: "No", last_name: "Team", position: "QB" },
        ];
        fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(players) });
        const { db } = makeDb();
        await syncPlayers({ games_db: db });
        expect(db.prepare).not.toHaveBeenCalled();
    });

    it("inserts a new player when they are not in the DB", async () => {
        const players = [{ id: 1, first_name: "John", last_name: "Doe", position: "QB", team: "Alabama" }];
        fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(players) });
        // First run() → SELECT returns empty; second run() → INSERT
        const { db, stmt, bind } = makeDb({ results: [] }, { results: [] });

        await syncPlayers({ games_db: db });

        expect(db.prepare).toHaveBeenCalledTimes(2);
        // The INSERT bind args should include the player fields
        const insertArgs = bind.mock.calls[1];
        expect(insertArgs[0]).toBe(1);          // PlayerId
        expect(insertArgs[1]).toBe("John");     // FirstName
        expect(insertArgs[2]).toBe("Doe");      // LastName
        expect(insertArgs[3]).toBe("QB");       // Position
    });

    it("skips updating when player already has that season+team", async () => {
        const year = "2004";
        const players = [{ id: 1, first_name: "Jane", last_name: "Smith", position: "RB", team: "Georgia" }];
        fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(players) });

        const existingSeasons = JSON.stringify([{ year, team: "Georgia" }]);
        const { db } = makeDb({ results: [{ PlayerId: 1, Seasons: existingSeasons }] });

        await syncPlayers({ games_db: db });

        // Only one DB call (the SELECT); no UPDATE issued
        expect(db.prepare).toHaveBeenCalledTimes(1);
    });

    it("updates Seasons when player exists but the season is new", async () => {
        const players = [{ id: 1, first_name: "Jane", last_name: "Smith", position: "RB", team: "LSU" }];
        fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(players) });

        const existingSeasons = JSON.stringify([{ year: "2004", team: "Georgia" }]);
        const { db, stmt, bind } = makeDb(
            { results: [{ PlayerId: 1, Seasons: existingSeasons }] }, // SELECT
            { results: [] }                                            // UPDATE
        );

        await syncPlayers({ games_db: db });

        expect(db.prepare).toHaveBeenCalledTimes(2);
        // UPDATE bind: first arg is new Seasons JSON, second is PlayerId
        const updatedSeasons = JSON.parse(bind.mock.calls[1][0]);
        expect(updatedSeasons).toHaveLength(2);
        expect(updatedSeasons[1]).toEqual({ year: "2004", team: "LSU" });
    });

    it("handles players with missing optional fields gracefully", async () => {
        const players = [{ id: 5, team: "Ohio State" }]; // no name/position
        fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(players) });
        const { db, bind } = makeDb({ results: [] }, { results: [] });

        await syncPlayers({ games_db: db });

        const insertArgs = bind.mock.calls[1];
        expect(insertArgs[1]).toBe("");  // FirstName defaults to ''
        expect(insertArgs[2]).toBe("");  // LastName defaults to ''
        expect(insertArgs[3]).toBe("");  // Position defaults to ''
    });
});

// ─── getRandomPlayer ─────────────────────────────────────────────────────────

describe("getRandomPlayer", () => {
    it("returns 404 when the Players table is empty", async () => {
        const { db } = makeDb({ results: [{ cnt: 0 }] });
        const res = await getRandomPlayer({ games_db: db });
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBeDefined();
    });

    it("returns 200 with the player shape when the table has rows", async () => {
        const fakePlayer = {
            PlayerId: 42,
            FirstName: "Bo",
            LastName: "Nix",
            Position: "QB",
            Seasons: JSON.stringify([{ year: "2023", team: "Oregon" }]),
        };
        const { db } = makeDb(
            { results: [{ cnt: 10 }] },          // COUNT query
            { results: [fakePlayer] }             // LIMIT/OFFSET query
        );

        const res = await getRandomPlayer({ games_db: db });
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.id).toBe(42);
        expect(body.firstName).toBe("Bo");
        expect(body.lastName).toBe("Nix");
        expect(body.position).toBe("QB");
        expect(body.seasons).toEqual([{ year: "2023", team: "Oregon" }]);
    });

    it("selects an offset within range of the player count", async () => {
        const fakePlayer = {
            PlayerId: 1,
            FirstName: "A",
            LastName: "B",
            Position: "WR",
            Seasons: "[]",
        };
        const mathSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
        const { db, bind } = makeDb(
            { results: [{ cnt: 100 }] },
            { results: [fakePlayer] }
        );

        await getRandomPlayer({ games_db: db });
        // COUNT query uses .prepare().run() directly (no .bind()); only the LIMIT/OFFSET query calls .bind()
        // offset = floor(0.5 * 100) = 50
        expect(bind.mock.calls[0][0]).toBe(50);
        mathSpy.mockRestore();
    });
});

// ─── getPlayerStats ───────────────────────────────────────────────────────────

describe("getPlayerStats", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("returns 400 when playerId is missing", async () => {
        const { db } = makeDb();
        const res = await getPlayerStats(makeRequest("/api/guys/player-stats"), { games_db: db });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBeDefined();
    });

    it("returns 400 when playerId is not a valid number", async () => {
        const { db } = makeDb();
        const res = await getPlayerStats(
            makeRequest("/api/guys/player-stats?playerId=abc"),
            { games_db: db }
        );
        expect(res.status).toBe(400);
    });

    it("returns 404 when the player is not found in the DB", async () => {
        const { db } = makeDb({ results: [] });
        const res = await getPlayerStats(
            makeRequest("/api/guys/player-stats?playerId=999"),
            { games_db: db }
        );
        expect(res.status).toBe(404);
    });

    it("returns 200 with QB stats filtered to passing and rushing categories", async () => {
        const seasons = JSON.stringify([{ year: "2023", team: "Oregon" }]);
        const { db } = makeDb({ results: [{ Position: "QB", Seasons: seasons }] });

        const statRows = [
            { player_id: 42, category: "passing", stat_type: "YDS", stat: 3500 },
            { player_id: 42, category: "rushing", stat_type: "YDS", stat: 400 },
            { player_id: 42, category: "receiving", stat_type: "REC", stat: 5 }, // should be filtered out
            { player_id: 99, category: "passing", stat_type: "YDS", stat: 1000 }, // different player
        ];
        fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(statRows) });

        const res = await getPlayerStats(
            makeRequest("/api/guys/player-stats?playerId=42"),
            { games_db: db }
        );
        expect(res.status).toBe(200);
        const body = await res.json();

        expect(body.playerId).toBe(42);
        expect(body.position).toBe("QB");
        expect(body.categories).toEqual(["passing", "rushing"]);

        const season = body.seasons[0];
        expect(season.stats.passing.YDS).toBe(3500);
        expect(season.stats.rushing.YDS).toBe(400);
        expect(season.stats.receiving).toBeUndefined();
    });

    it("returns defensive categories for a defensive position", async () => {
        const seasons = JSON.stringify([{ year: "2023", team: "Alabama" }]);
        const { db } = makeDb({ results: [{ Position: "LB", Seasons: seasons }] });

        fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([
            { player_id: 7, category: "defensive", stat_type: "TOT", stat: 80 },
            { player_id: 7, category: "interceptions", stat_type: "INT", stat: 2 },
        ]) });

        const res = await getPlayerStats(
            makeRequest("/api/guys/player-stats?playerId=7"),
            { games_db: db }
        );
        const body = await res.json();
        expect(body.categories).toEqual(["defensive", "interceptions", "fumbles"]);
        expect(body.seasons[0].stats.defensive.TOT).toBe(80);
        expect(body.seasons[0].stats.interceptions.INT).toBe(2);
    });

    it("returns all categories for an unknown position", async () => {
        const seasons = JSON.stringify([{ year: "2023", team: "Michigan" }]);
        const { db } = makeDb({ results: [{ Position: "OL", Seasons: seasons }] });

        fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([
            { player_id: 3, category: "rushing", stat_type: "YDS", stat: 10 },
        ]) });

        const res = await getPlayerStats(
            makeRequest("/api/guys/player-stats?playerId=3"),
            { games_db: db }
        );
        const body = await res.json();
        // OL is not in any known position map → categories is null → returns all CATEGORY_COLUMNS keys
        expect(body.categories).toBeInstanceOf(Array);
        expect(body.categories.length).toBeGreaterThan(4);
        expect(body.seasons[0].stats.rushing.YDS).toBe(10);
    });

    it("fetches stats for each season in the player's Seasons array", async () => {
        const seasons = JSON.stringify([
            { year: "2021", team: "LSU" },
            { year: "2022", team: "Oregon" },
        ]);
        const { db } = makeDb({ results: [{ Position: "WR", Seasons: seasons }] });

        fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });

        await getPlayerStats(
            makeRequest("/api/guys/player-stats?playerId=10"),
            { games_db: db }
        );

        expect(fetch).toHaveBeenCalledTimes(2);
        const urls = fetch.mock.calls.map(([url]) => url);
        expect(urls.some(u => u.includes("year=2021") && u.includes("LSU"))).toBe(true);
        expect(urls.some(u => u.includes("year=2022") && u.includes("Oregon"))).toBe(true);
    });

    it("handles a failed CFBD fetch gracefully by returning empty stats", async () => {
        const seasons = JSON.stringify([{ year: "2023", team: "Texas" }]);
        const { db } = makeDb({ results: [{ Position: "RB", Seasons: seasons }] });

        fetch.mockResolvedValue({ ok: false, status: 503 });

        const res = await getPlayerStats(
            makeRequest("/api/guys/player-stats?playerId=5"),
            { games_db: db }
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.seasons[0].stats).toEqual({});
    });
});
