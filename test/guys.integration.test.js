import { describe, it, expect, vi, beforeEach } from "vitest";
import { getRandomPlayer, getPlayerById, getPlayerStats } from "../server/guys.js";
import * as cfbd from "../server/cfbd.js";

vi.mock("../server/cfbd.js");

const FAKE_ENV = { CFBD_TOKEN: "Bearer test" };

function makeRequest(path) {
    return new Request(`http://fake-host${path}`);
}

beforeEach(() => {
    vi.clearAllMocks();
});

// ─── getRandomPlayer ─────────────────────────────────────────────────────────

describe("getRandomPlayer", () => {
    it("returns a player with the correct response shape", async () => {
        cfbd.cfbdGql
            .mockResolvedValueOnce({ athleteAggregate: { aggregate: { count: 50 } } })
            .mockResolvedValueOnce({
                athlete: [{
                    id: 101,
                    firstName: "Bo",
                    lastName: "Nix",
                    position: { abbreviation: "QB" },
                    athleteTeams: [
                        { startYear: 2019, team: { school: "Auburn" } },
                        { startYear: 2022, team: { school: "Oregon" } },
                    ],
                }],
            });

        const res = await getRandomPlayer(FAKE_ENV);
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.id).toBe(101);
        expect(body.firstName).toBe("Bo");
        expect(body.lastName).toBe("Nix");
        expect(body.position).toBe("QB");
        expect(body.seasons).toEqual([
            { year: "2019", team: "Auburn" },
            { year: "2022", team: "Oregon" },
        ]);
    });

    it("returns 404 when no athletes exist", async () => {
        cfbd.cfbdGql.mockResolvedValueOnce({ athleteAggregate: { aggregate: { count: 0 } } });

        const res = await getRandomPlayer(FAKE_ENV);
        expect(res.status).toBe(404);
        expect((await res.json()).error).toBeDefined();
    });
});

// ─── getPlayerById ───────────────────────────────────────────────────────────

describe("getPlayerById", () => {
    it("returns a player with the correct response shape", async () => {
        cfbd.cfbdGql.mockResolvedValueOnce({
            athleteByPk: {
                id: 202,
                firstName: "Jeremiah",
                lastName: "Trotter",
                position: { abbreviation: "LB" },
                athleteTeams: [{ startYear: 2023, team: { school: "USC" } }],
            },
        });

        const res = await getPlayerById(makeRequest("/api/guys/player?playerId=202"), FAKE_ENV);
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.id).toBe(202);
        expect(body.firstName).toBe("Jeremiah");
        expect(body.position).toBe("LB");
        expect(body.seasons).toEqual([{ year: "2023", team: "USC" }]);
    });

    it("returns 400 for a missing playerId", async () => {
        const res = await getPlayerById(makeRequest("/api/guys/player"), FAKE_ENV);
        expect(res.status).toBe(400);
    });

    it("returns 404 for an unknown player", async () => {
        cfbd.cfbdGql.mockResolvedValueOnce({ athleteByPk: null });
        const res = await getPlayerById(makeRequest("/api/guys/player?playerId=9999"), FAKE_ENV);
        expect(res.status).toBe(404);
    });
});

// ─── getPlayerStats ───────────────────────────────────────────────────────────

describe("getPlayerStats", () => {
    it("returns stats for a QB with passing and rushing categories", async () => {
        cfbd.cfbdGql
            .mockResolvedValueOnce({
                athleteByPk: {
                    position: { abbreviation: "QB" },
                    athleteTeams: [{ startYear: 2023, team: { school: "Oregon" } }],
                },
            })
            .mockResolvedValueOnce({
                gamePlayerStat: [
                    { year: 2023, team: { school: "Oregon" }, category: "passing", statType: "YDS",  stat: 3500 },
                    { year: 2023, team: { school: "Oregon" }, category: "passing", statType: "TD",   stat: 29 },
                    { year: 2023, team: { school: "Oregon" }, category: "passing", statType: "INT",  stat: 5 },
                    { year: 2023, team: { school: "Oregon" }, category: "rushing", statType: "YDS",  stat: 400 },
                    { year: 2023, team: { school: "Oregon" }, category: "rushing", statType: "TD",   stat: 6 },
                    // receiving should be excluded for a QB
                    { year: 2023, team: { school: "Oregon" }, category: "receiving", statType: "REC", stat: 3 },
                ],
            });

        const res = await getPlayerStats(makeRequest("/api/guys/player-stats?playerId=101"), FAKE_ENV);
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.playerId).toBe(101);
        expect(body.position).toBe("QB");
        expect(body.categories).toEqual(["passing", "rushing"]);
        expect(body.categoryColumns).toBeDefined();
        expect(body.seasons).toHaveLength(1);

        const season = body.seasons[0];
        expect(season.year).toBe("2023");
        expect(season.team).toBe("Oregon");
        expect(season.stats.passing.YDS).toBe(3500);
        expect(season.stats.passing.TD).toBe(29);
        expect(season.stats.rushing.YDS).toBe(400);
    });

    it("returns stats for a LB with defensive categories", async () => {
        cfbd.cfbdGql
            .mockResolvedValueOnce({
                athleteByPk: {
                    position: { abbreviation: "LB" },
                    athleteTeams: [{ startYear: 2023, team: { school: "USC" } }],
                },
            })
            .mockResolvedValueOnce({
                gamePlayerStat: [
                    { year: 2023, team: { school: "USC" }, category: "defensive",     statType: "TOT",  stat: 74 },
                    { year: 2023, team: { school: "USC" }, category: "defensive",     statType: "SOLO", stat: 44 },
                    { year: 2023, team: { school: "USC" }, category: "interceptions", statType: "INT",  stat: 1 },
                ],
            });

        const res = await getPlayerStats(makeRequest("/api/guys/player-stats?playerId=202"), FAKE_ENV);
        const body = await res.json();

        expect(body.position).toBe("LB");
        expect(body.categories).toEqual(["defensive", "interceptions", "fumbles"]);
        expect(body.seasons[0].stats.defensive.TOT).toBe(74);
        expect(body.seasons[0].stats.defensive.SOLO).toBe(44);
        expect(body.seasons[0].stats.interceptions.INT).toBe(1);
    });

    it("groups stats across multiple seasons into separate season entries", async () => {
        cfbd.cfbdGql
            .mockResolvedValueOnce({
                athleteByPk: {
                    position: { abbreviation: "WR" },
                    athleteTeams: [
                        { startYear: 2021, team: { school: "LSU" } },
                        { startYear: 2022, team: { school: "Oregon" } },
                    ],
                },
            })
            .mockResolvedValueOnce({
                gamePlayerStat: [
                    { year: 2021, team: { school: "LSU" },    category: "receiving", statType: "YDS", stat: 800 },
                    { year: 2021, team: { school: "LSU" },    category: "receiving", statType: "REC", stat: 50 },
                    { year: 2022, team: { school: "Oregon" }, category: "receiving", statType: "YDS", stat: 1200 },
                    { year: 2022, team: { school: "Oregon" }, category: "receiving", statType: "REC", stat: 75 },
                ],
            });

        const res = await getPlayerStats(makeRequest("/api/guys/player-stats?playerId=10"), FAKE_ENV);
        const body = await res.json();

        expect(body.seasons).toHaveLength(2);
        const lsu = body.seasons.find(s => s.team === "LSU");
        expect(lsu.year).toBe("2021");
        expect(lsu.stats.receiving.YDS).toBe(800);
        expect(lsu.stats.receiving.REC).toBe(50);

        const oregon = body.seasons.find(s => s.team === "Oregon");
        expect(oregon.year).toBe("2022");
        expect(oregon.stats.receiving.YDS).toBe(1200);
    });

    it("returns 400 for a missing playerId", async () => {
        const res = await getPlayerStats(makeRequest("/api/guys/player-stats"), FAKE_ENV);
        expect(res.status).toBe(400);
    });

    it("returns 404 for an unknown player", async () => {
        cfbd.cfbdGql.mockResolvedValueOnce({ athleteByPk: null });
        const res = await getPlayerStats(makeRequest("/api/guys/player-stats?playerId=9999"), FAKE_ENV);
        expect(res.status).toBe(404);
    });

    it("returns empty seasons when no stat rows exist", async () => {
        cfbd.cfbdGql
            .mockResolvedValueOnce({
                athleteByPk: {
                    position: { abbreviation: "RB" },
                    athleteTeams: [{ startYear: 2023, team: { school: "Texas" } }],
                },
            })
            .mockResolvedValueOnce({ gamePlayerStat: [] });

        const res = await getPlayerStats(makeRequest("/api/guys/player-stats?playerId=5"), FAKE_ENV);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.seasons).toEqual([]);
    });
});
