import { describe, it, expect, vi, beforeEach } from "vitest";
import { getRandomPlayer, getPlayerById, getPlayerStats } from "../server/guys.js";
import * as cfbd from "../server/cfbd.js";

vi.mock("../server/cfbd.js");

function makeRequest(path) {
    return new Request(`http://fake-host${path}`);
}

// Athlete object as returned by the GraphQL API
function makeAthlete(id, firstName, lastName, posAbbr, teams = []) {
    return {
        id,
        firstName,
        lastName,
        position: { abbreviation: posAbbr },
        athleteTeams: teams.map(({ year, school }) => ({
            startYear: year,
            team: { school },
        })),
    };
}

// Minimal env — cfbdGql is mocked so CFBD_TOKEN is never used
const FAKE_ENV = { CFBD_TOKEN: "Bearer test" };

beforeEach(() => {
    vi.clearAllMocks();
});

// ─── getRandomPlayer ─────────────────────────────────────────────────────────

describe("getRandomPlayer", () => {
    it("returns 404 when athlete count is 0", async () => {
        cfbd.cfbdGql.mockResolvedValueOnce({ athleteAggregate: { aggregate: { count: 0 } } });

        const res = await getRandomPlayer(FAKE_ENV);
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBeDefined();
    });

    it("returns 200 with the correct player shape", async () => {
        cfbd.cfbdGql
            .mockResolvedValueOnce({ athleteAggregate: { aggregate: { count: 10 } } })
            .mockResolvedValueOnce({ athlete: [makeAthlete(42, "Bo", "Nix", "QB", [{ year: 2023, school: "Oregon" }])] });

        const res = await getRandomPlayer(FAKE_ENV);
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.id).toBe(42);
        expect(body.firstName).toBe("Bo");
        expect(body.lastName).toBe("Nix");
        expect(body.position).toBe("QB");
        expect(body.seasons).toEqual([{ year: "2023", team: "Oregon" }]);
    });

    it("selects an offset within the athlete count", async () => {
        vi.spyOn(Math, "random").mockReturnValue(0.5);

        cfbd.cfbdGql
            .mockResolvedValueOnce({ athleteAggregate: { aggregate: { count: 100 } } })
            .mockResolvedValueOnce({ athlete: [makeAthlete(1, "A", "B", "WR")] });

        await getRandomPlayer(FAKE_ENV);

        // Second cfbdGql call should pass offset = floor(0.5 * 100) = 50
        const secondCallVars = cfbd.cfbdGql.mock.calls[1][1];
        expect(secondCallVars.offset).toBe(50);
    });

    it("returns 404 when the athlete query returns empty", async () => {
        cfbd.cfbdGql
            .mockResolvedValueOnce({ athleteAggregate: { aggregate: { count: 5 } } })
            .mockResolvedValueOnce({ athlete: [] });

        const res = await getRandomPlayer(FAKE_ENV);
        expect(res.status).toBe(404);
    });
});

// ─── getPlayerById ───────────────────────────────────────────────────────────

describe("getPlayerById", () => {
    it("returns 400 when playerId is missing", async () => {
        const res = await getPlayerById(makeRequest("/api/guys/player"), FAKE_ENV);
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBeDefined();
    });

    it("returns 400 when playerId is non-numeric", async () => {
        const res = await getPlayerById(makeRequest("/api/guys/player?playerId=abc"), FAKE_ENV);
        expect(res.status).toBe(400);
    });

    it("returns 404 when athlete is not found", async () => {
        cfbd.cfbdGql.mockResolvedValueOnce({ athleteByPk: null });

        const res = await getPlayerById(makeRequest("/api/guys/player?playerId=999"), FAKE_ENV);
        expect(res.status).toBe(404);
    });

    it("returns 200 with the correct player shape", async () => {
        cfbd.cfbdGql.mockResolvedValueOnce({
            athleteByPk: makeAthlete(42, "Bo", "Nix", "QB", [{ year: 2023, school: "Oregon" }]),
        });

        const res = await getPlayerById(makeRequest("/api/guys/player?playerId=42"), FAKE_ENV);
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.id).toBe(42);
        expect(body.firstName).toBe("Bo");
        expect(body.position).toBe("QB");
        expect(body.seasons).toEqual([{ year: "2023", team: "Oregon" }]);
    });
});

// ─── getPlayerStats ───────────────────────────────────────────────────────────

describe("getPlayerStats", () => {
    it("returns 400 when playerId is missing", async () => {
        const res = await getPlayerStats(makeRequest("/api/guys/player-stats"), FAKE_ENV);
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBeDefined();
    });

    it("returns 400 when playerId is non-numeric", async () => {
        const res = await getPlayerStats(makeRequest("/api/guys/player-stats?playerId=abc"), FAKE_ENV);
        expect(res.status).toBe(400);
    });

    it("returns 404 when the athlete is not found", async () => {
        cfbd.cfbdGql.mockResolvedValueOnce({ athleteByPk: null });

        const res = await getPlayerStats(makeRequest("/api/guys/player-stats?playerId=999"), FAKE_ENV);
        expect(res.status).toBe(404);
    });

    it("returns 200 with passing and rushing categories for QB", async () => {
        cfbd.cfbdGql
            .mockResolvedValueOnce({
                athleteByPk: {
                    position: { abbreviation: "QB" },
                    athleteTeams: [{ startYear: 2023, team: { school: "Oregon" } }],
                },
            })
            .mockResolvedValueOnce({
                gamePlayerStat: [
                    { year: 2023, team: { school: "Oregon" }, category: "passing", statType: "YDS", stat: 3500 },
                    { year: 2023, team: { school: "Oregon" }, category: "rushing", statType: "YDS", stat: 400 },
                    { year: 2023, team: { school: "Oregon" }, category: "receiving", statType: "REC", stat: 5 },
                ],
            });

        const res = await getPlayerStats(makeRequest("/api/guys/player-stats?playerId=42"), FAKE_ENV);
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.playerId).toBe(42);
        expect(body.position).toBe("QB");
        expect(body.categories).toEqual(["passing", "rushing"]);
        expect(body.seasons[0].stats.passing.YDS).toBe(3500);
        expect(body.seasons[0].stats.rushing.YDS).toBe(400);
    });

    it("returns defensive categories for a linebacker", async () => {
        cfbd.cfbdGql
            .mockResolvedValueOnce({
                athleteByPk: {
                    position: { abbreviation: "LB" },
                    athleteTeams: [{ startYear: 2023, team: { school: "Alabama" } }],
                },
            })
            .mockResolvedValueOnce({
                gamePlayerStat: [
                    { year: 2023, team: { school: "Alabama" }, category: "defensive", statType: "TOT", stat: 80 },
                    { year: 2023, team: { school: "Alabama" }, category: "interceptions", statType: "INT", stat: 2 },
                ],
            });

        const res = await getPlayerStats(makeRequest("/api/guys/player-stats?playerId=7"), FAKE_ENV);
        const body = await res.json();
        expect(body.categories).toEqual(["defensive", "interceptions", "fumbles"]);
        expect(body.seasons[0].stats.defensive.TOT).toBe(80);
    });

    it("groups stats by year and team", async () => {
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
                    { year: 2022, team: { school: "Oregon" }, category: "receiving", statType: "YDS", stat: 1200 },
                ],
            });

        const res = await getPlayerStats(makeRequest("/api/guys/player-stats?playerId=10"), FAKE_ENV);
        const body = await res.json();
        expect(body.seasons).toHaveLength(2);
        const lsuSeason = body.seasons.find(s => s.team === "LSU");
        expect(lsuSeason.stats.receiving.YDS).toBe(800);
        const oregonSeason = body.seasons.find(s => s.team === "Oregon");
        expect(oregonSeason.stats.receiving.YDS).toBe(1200);
    });

    it("returns empty stats when gamePlayerStat returns no rows", async () => {
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

    it("includes categoryColumns in the response", async () => {
        cfbd.cfbdGql
            .mockResolvedValueOnce({
                athleteByPk: { position: { abbreviation: "QB" }, athleteTeams: [] },
            })
            .mockResolvedValueOnce({ gamePlayerStat: [] });

        const res = await getPlayerStats(makeRequest("/api/guys/player-stats?playerId=1"), FAKE_ENV);
        const body = await res.json();
        expect(body.categoryColumns).toBeDefined();
        expect(body.categoryColumns.passing).toContain("YDS");
    });
});
