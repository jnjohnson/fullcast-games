import { describe, it, expect, vi, beforeEach } from "vitest";
import { getRandomPlayer, getPlayerById, getPlayerStats } from "../server/guys.js";
import * as cfbd from "../server/cfbd.js";

vi.mock("../server/cfbd.js");

const FAKE_ENV = { CFBD_TOKEN: "Bearer test" };

function makeRequest(path) {
    return new Request(`http://fake-host${path}`);
}

// Shape that gamePlayerStat rows have in the actual GraphQL response
function makeStatRow(category, statType, stat, season, nickname = "Tigers", startYear = 2023) {
    return {
        athlete: { athleteTeams: [{ startYear, team: { nickname } }] },
        gameTeam: { game: { season } },
        playerStatCategory: { name: category },
        playerStatType: { name: statType },
        stat: String(stat),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

// ─── getRandomPlayer ─────────────────────────────────────────────────────────

describe("getRandomPlayer", () => {
    it("returns a player with the correct .player and .stats shape", async () => {
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
            })
            .mockResolvedValueOnce({ gamePlayerStat: [
                makeStatRow("passing", "YDS", 3200, 2023, "Ducks", 2022),
                makeStatRow("rushing", "YDS", 350, 2023, "Ducks", 2022),
            ] });

        const res = await getRandomPlayer(FAKE_ENV);
        expect(res.status).toBe(200);

        const { player, stats } = await res.json();
        expect(player.id).toBe(101);
        expect(player.firstName).toBe("Bo");
        expect(player.lastName).toBe("Nix");
        expect(player.position.abbreviation).toBe("QB");
        expect(player.athleteTeams).toHaveLength(2);
        expect(player.athleteTeams[0].team.school).toBe("Auburn");
        expect(player.athleteTeams[1].team.school).toBe("Oregon");
        expect(stats.passing).toBeDefined();
        expect(stats.passing.statNames).toContain("YDS");
        expect(stats.rushing).toBeDefined();
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
    it("returns a player with the correct .player and .stats shape", async () => {
        cfbd.cfbdGql
            .mockResolvedValueOnce({
                athleteByPk: {
                    id: 202,
                    firstName: "Jeremiah",
                    lastName: "Trotter",
                    position: { abbreviation: "LB" },
                    athleteTeams: [{ startYear: 2023, team: { school: "USC" } }],
                },
            })
            .mockResolvedValueOnce({ gamePlayerStat: [
                makeStatRow("defensive", "TOT", 74, 2023, "Trojans", 2023),
            ] });

        const res = await getPlayerById(makeRequest("/api/guys/player?playerId=202"), FAKE_ENV);
        expect(res.status).toBe(200);

        const { player, stats } = await res.json();
        expect(player.id).toBe(202);
        expect(player.firstName).toBe("Jeremiah");
        expect(player.position.abbreviation).toBe("LB");
        expect(player.athleteTeams[0].team.school).toBe("USC");
        expect(stats.defensive).toBeDefined();
        expect(stats.defensive.seasons[0].stats.TOT).toBe(74);
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
        cfbd.cfbdGql.mockResolvedValueOnce({ gamePlayerStat: [
            makeStatRow("passing", "YDS", 3500, 2023, "Ducks", 2023),
            makeStatRow("passing", "TD",  29,   2023, "Ducks", 2023),
            makeStatRow("rushing", "YDS", 400,  2023, "Ducks", 2023),
            makeStatRow("rushing", "TD",  6,    2023, "Ducks", 2023),
        ] });

        const result = await getPlayerStats(101, FAKE_ENV);
        expect(result.passing.statNames).toContain("YDS");
        expect(result.passing.statNames).toContain("TD");
        expect(result.passing.seasons).toHaveLength(1);
        expect(result.passing.seasons[0].season).toBe(2023);
        expect(result.passing.seasons[0].team).toBe("Ducks");
        expect(result.passing.seasons[0].stats.YDS).toBe(3500);
        expect(result.passing.seasons[0].stats.TD).toBe(29);
        expect(result.rushing.seasons[0].stats.YDS).toBe(400);
        expect(result.rushing.seasons[0].stats.TD).toBe(6);
    });

    it("returns stats for a LB with defensive categories", async () => {
        cfbd.cfbdGql.mockResolvedValueOnce({ gamePlayerStat: [
            makeStatRow("defensive",     "TOT",  74, 2023, "Trojans", 2023),
            makeStatRow("defensive",     "SOLO", 44, 2023, "Trojans", 2023),
            makeStatRow("interceptions", "INT",  1,  2023, "Trojans", 2023),
        ] });

        const result = await getPlayerStats(202, FAKE_ENV);
        expect(result.defensive.seasons[0].stats.TOT).toBe(74);
        expect(result.defensive.seasons[0].stats.SOLO).toBe(44);
        expect(result.interceptions.seasons[0].stats.INT).toBe(1);
    });

    it("groups stats across multiple seasons into separate season entries", async () => {
        cfbd.cfbdGql.mockResolvedValueOnce({ gamePlayerStat: [
            makeStatRow("receiving", "YDS", 800,  2021, "Tigers", 2019),
            makeStatRow("receiving", "REC", 50,   2021, "Tigers", 2019),
            makeStatRow("receiving", "YDS", 1200, 2022, "Ducks",  2022),
            makeStatRow("receiving", "REC", 75,   2022, "Ducks",  2022),
        ] });

        const result = await getPlayerStats(10, FAKE_ENV);
        expect(result.receiving.seasons).toHaveLength(2);
        const lsu = result.receiving.seasons.find(s => s.season === 2021);
        expect(lsu.team).toBe("Tigers");
        expect(lsu.stats.YDS).toBe(800);
        expect(lsu.stats.REC).toBe(50);
        const oregon = result.receiving.seasons.find(s => s.season === 2022);
        expect(oregon.team).toBe("Ducks");
        expect(oregon.stats.YDS).toBe(1200);
    });

    it("returns 400 for a missing playerId", async () => {
        const res = await getPlayerStats(null, FAKE_ENV);
        expect(res.status).toBe(400);
    });

    it("returns 404 when cfbdGql throws", async () => {
        cfbd.cfbdGql.mockRejectedValueOnce(new Error("network error"));
        const res = await getPlayerStats(9999, FAKE_ENV);
        expect(res.status).toBe(404);
    });

    it("returns empty object when no stat rows exist", async () => {
        cfbd.cfbdGql.mockResolvedValueOnce({ gamePlayerStat: [] });

        const result = await getPlayerStats(5, FAKE_ENV);
        expect(result).toEqual({});
    });
});
