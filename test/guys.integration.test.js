import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";

const TEST_PLAYERS = [
    {
        PlayerId: 101,
        FirstName: "Bo",
        LastName: "Nix",
        Position: "QB",
        Seasons: JSON.stringify([{ year: "2023", team: "Oregon" }]),
    },
    {
        PlayerId: 202,
        FirstName: "Jeremiah",
        LastName: "Trotter",
        Position: "LB",
        Seasons: JSON.stringify([{ year: "2023", team: "USC" }]),
    },
];

beforeAll(async () => {
    await env.games_db
        .prepare(
            "CREATE TABLE IF NOT EXISTS Players (PlayerId INTEGER PRIMARY KEY, FirstName TEXT, LastName TEXT, Position TEXT, Seasons TEXT)"
        )
        .run();
    for (const p of TEST_PLAYERS) {
        await env.games_db
            .prepare(
                "INSERT OR REPLACE INTO Players (PlayerId, FirstName, LastName, Position, Seasons) VALUES (?, ?, ?, ?, ?)"
            )
            .bind(p.PlayerId, p.FirstName, p.LastName, p.Position, p.Seasons)
            .run();
    }
});

// Restore any fetch stubs after each test that uses them
afterEach(() => {
    vi.unstubAllGlobals();
});

// ─── GET /api/guys/random-player ─────────────────────────────────────────────

describe("GET /api/guys/random-player", () => {
    it("returns 200 with the correct player shape", async () => {
        const res = await SELF.fetch("http://fake-host/api/guys/random-player");
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.id).toBeTypeOf("number");
        expect(body.firstName).toBeTypeOf("string");
        expect(body.lastName).toBeTypeOf("string");
        expect(body.position).toBeTypeOf("string");
        expect(body.seasons).toBeInstanceOf(Array);
    });

    it("returns one of the seeded players", async () => {
        const res = await SELF.fetch("http://fake-host/api/guys/random-player");
        const body = await res.json();
        const seededIds = TEST_PLAYERS.map(p => p.PlayerId);
        expect(seededIds).toContain(body.id);
    });

    it("returns seasons as a parsed array with year and team", async () => {
        const res = await SELF.fetch("http://fake-host/api/guys/random-player");
        const { seasons } = await res.json();
        expect(seasons.length).toBeGreaterThan(0);
        expect(seasons[0]).toHaveProperty("year");
        expect(seasons[0]).toHaveProperty("team");
    });

    it("returns 404 when the Players table is empty", async () => {
        await env.games_db.prepare("DELETE FROM Players").run();

        const res = await SELF.fetch("http://fake-host/api/guys/random-player");
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBeDefined();

        // Re-seed for subsequent tests
        for (const p of TEST_PLAYERS) {
            await env.games_db
                .prepare(
                    "INSERT OR REPLACE INTO Players (PlayerId, FirstName, LastName, Position, Seasons) VALUES (?, ?, ?, ?, ?)"
                )
                .bind(p.PlayerId, p.FirstName, p.LastName, p.Position, p.Seasons)
                .run();
        }
    });
});

// ─── GET /api/guys/player-stats ──────────────────────────────────────────────

describe("GET /api/guys/player-stats", () => {
    it("returns 400 when playerId is missing", async () => {
        const res = await SELF.fetch("http://fake-host/api/guys/player-stats");
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBeDefined();
    });

    it("returns 404 for a playerId that does not exist", async () => {
        const res = await SELF.fetch("http://fake-host/api/guys/player-stats?playerId=9999");
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBeDefined();
    });

    it("returns 200 with correct structure for a known QB player", async () => {
        const statRows = [
            { player_id: 101, category: "passing", stat_type: "YDS", stat: 3500 },
            { player_id: 101, category: "passing", stat_type: "TD",  stat: 29 },
            { player_id: 101, category: "rushing", stat_type: "YDS", stat: 400 },
        ];
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(statRows),
        }));

        const res = await SELF.fetch("http://fake-host/api/guys/player-stats?playerId=101");
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.playerId).toBe(101);
        expect(body.position).toBe("QB");
        expect(body.categories).toContain("passing");
        expect(body.categories).toContain("rushing");
        expect(body.seasons).toHaveLength(1);
        expect(body.seasons[0].year).toBe("2023");
        expect(body.seasons[0].team).toBe("Oregon");
        expect(body.seasons[0].stats.passing.YDS).toBe(3500);
        expect(body.seasons[0].stats.passing.TD).toBe(29);
        expect(body.seasons[0].stats.rushing.YDS).toBe(400);
    });

    it("returns 200 with defensive categories for a LB player", async () => {
        const statRows = [
            { player_id: 202, category: "defensive",     stat_type: "TOT",  stat: 74 },
            { player_id: 202, category: "interceptions", stat_type: "INT",  stat: 1 },
        ];
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(statRows),
        }));

        const res = await SELF.fetch("http://fake-host/api/guys/player-stats?playerId=202");
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.position).toBe("LB");
        expect(body.categories).toEqual(["defensive", "interceptions", "fumbles"]);
        expect(body.seasons[0].stats.defensive.TOT).toBe(74);
    });

    it("returns empty stats object per season when the CFBD API call fails", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));

        const res = await SELF.fetch("http://fake-host/api/guys/player-stats?playerId=101");
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.seasons[0].stats).toEqual({});
    });

    it("includes categoryColumns in the response", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([]),
        }));

        const res = await SELF.fetch("http://fake-host/api/guys/player-stats?playerId=101");
        const body = await res.json();
        expect(body.categoryColumns).toBeDefined();
        expect(body.categoryColumns.passing).toContain("YDS");
    });
});
