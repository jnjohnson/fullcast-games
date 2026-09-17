import { describe, it, expect, vi, beforeEach } from "vitest";
import { getRandomPlayer, getPlayerById, getPlayerStats } from "../server/guys.js";
import * as cfbd from "../server/cfbd.js";

vi.mock("../server/cfbd.js");

function makeRequest(path) {
    return new Request(`http://fake-host${path}`);
}

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

    it("returns 200 with player nested under .player and stats under .stats", async () => {
        cfbd.cfbdGql
            .mockResolvedValueOnce({ athleteAggregate: { aggregate: { count: 10 } } })
            .mockResolvedValueOnce({ athlete: [makeAthlete(42, "Bo", "Nix", "QB", [{ year: 2019, school: "Auburn" }])] })
            .mockResolvedValueOnce({ gamePlayerStat: [makeStatRow("rushing", "YDS", 400, 2023, "Tigers", 2019)] });

        const res = await getRandomPlayer(FAKE_ENV);
        expect(res.status).toBe(200);

        const { player, stats } = await res.json();
        expect(player.id).toBe(42);
        expect(player.firstName).toBe("Bo");
        expect(player.lastName).toBe("Nix");
        expect(player.position.abbreviation).toBe("QB");
        expect(player.athleteTeams[0].team.school).toBe("Auburn");
        expect(stats.rushing).toBeDefined();
        expect(stats.rushing.seasons[0].season).toBe(2023);
        expect(stats.rushing.seasons[0].stats.YDS).toBe(400);
    });

    it("selects an offset within the athlete count", async () => {
        vi.spyOn(Math, "random").mockReturnValue(0.5);

        cfbd.cfbdGql
            .mockResolvedValueOnce({ athleteAggregate: { aggregate: { count: 100 } } })
            .mockResolvedValueOnce({ athlete: [makeAthlete(1, "A", "B", "WR")] })
            .mockResolvedValueOnce({ gamePlayerStat: [makeStatRow("receiving", "YDS", 100, 2023)] });

        await getRandomPlayer(FAKE_ENV);

        // Second call is the athlete query; offset should be floor(0.5 * 100) = 50
        expect(cfbd.cfbdGql.mock.calls[1][1].offset).toBe(50);
    });
});

// ─── getPlayerById ───────────────────────────────────────────────────────────

describe("getPlayerById", () => {
    it("returns 400 when playerId is missing", async () => {
        const res = await getPlayerById(makeRequest("/api/guys/player"), FAKE_ENV);
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBeDefined();
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

    it("returns 200 with player nested under .player and stats under .stats", async () => {
        cfbd.cfbdGql
            .mockResolvedValueOnce({ athleteByPk: makeAthlete(42, "Bo", "Nix", "QB", [{ year: 2023, school: "Oregon" }]) })
            .mockResolvedValueOnce({ gamePlayerStat: [makeStatRow("passing", "YDS", 3500, 2023, "Ducks", 2023)] });

        const res = await getPlayerById(makeRequest("/api/guys/player?playerId=42"), FAKE_ENV);
        expect(res.status).toBe(200);

        const { player, stats } = await res.json();
        expect(player.id).toBe(42);
        expect(player.firstName).toBe("Bo");
        expect(player.position.abbreviation).toBe("QB");
        expect(player.athleteTeams[0].team.school).toBe("Oregon");
        expect(stats.passing).toBeDefined();
        expect(stats.passing.seasons[0].stats.YDS).toBe(3500);
    });
});

// ─── getPlayerStats ───────────────────────────────────────────────────────────

describe("getPlayerStats", () => {
    it("returns 400 when playerId is falsy", async () => {
        const res = await getPlayerStats(null, FAKE_ENV);
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBeDefined();
    });

    it("returns 404 when cfbdGql throws", async () => {
        cfbd.cfbdGql.mockRejectedValueOnce(new Error("GraphQL error"));

        const res = await getPlayerStats(999, FAKE_ENV);
        expect(res.status).toBe(404);
    });

    it("returns a statMap with correct structure for passing and rushing", async () => {
        cfbd.cfbdGql.mockResolvedValueOnce({ gamePlayerStat: [
            makeStatRow("passing", "YDS", 3500, 2023, "Ducks", 2023),
            makeStatRow("passing", "TD",  29,   2023, "Ducks", 2023),
            makeStatRow("rushing", "YDS", 400,  2023, "Ducks", 2023),
        ] });

        const result = await getPlayerStats(42, FAKE_ENV);
        expect(result.passing).toBeDefined();
        expect(result.passing.statNames).toContain("YDS");
        expect(result.passing.statNames).toContain("TD");
        expect(result.passing.seasons[0].season).toBe(2023);
        expect(result.passing.seasons[0].team).toBe("Ducks");
        expect(result.passing.seasons[0].stats.YDS).toBe(3500);
        expect(result.passing.seasons[0].stats.TD).toBe(29);
        expect(result.rushing.seasons[0].stats.YDS).toBe(400);
    });

    it("returns defensive stats for a linebacker", async () => {
        cfbd.cfbdGql.mockResolvedValueOnce({ gamePlayerStat: [
            makeStatRow("defensive",     "TOT",  80, 2023, "Tide", 2023),
            makeStatRow("defensive",     "SOLO", 50, 2023, "Tide", 2023),
            makeStatRow("interceptions", "INT",  2,  2023, "Tide", 2023),
        ] });

        const result = await getPlayerStats(7, FAKE_ENV);
        expect(result.defensive.seasons[0].stats.TOT).toBe(80);
        expect(result.defensive.seasons[0].stats.SOLO).toBe(50);
        expect(result.interceptions.seasons[0].stats.INT).toBe(2);
    });

    it("groups stats across multiple seasons into separate season entries", async () => {
        cfbd.cfbdGql.mockResolvedValueOnce({ gamePlayerStat: [
            makeStatRow("receiving", "YDS", 800,  2021, "Tigers", 2019),
            makeStatRow("receiving", "YDS", 1200, 2022, "Ducks",  2022),
        ] });

        const result = await getPlayerStats(10, FAKE_ENV);
        expect(result.receiving.seasons).toHaveLength(2);
        const s2021 = result.receiving.seasons.find(s => s.season === 2021);
        expect(s2021.stats.YDS).toBe(800);
        const s2022 = result.receiving.seasons.find(s => s.season === 2022);
        expect(s2022.stats.YDS).toBe(1200);
    });

    it("returns an empty object when no stat rows exist", async () => {
        cfbd.cfbdGql.mockResolvedValueOnce({ gamePlayerStat: [] });

        const result = await getPlayerStats(5, FAKE_ENV);
        expect(result).toEqual({});
    });

    it("renames kickReturns to 'Kick Returns' and puntReturns to 'Punt Returns'", async () => {
        cfbd.cfbdGql.mockResolvedValueOnce({ gamePlayerStat: [
            makeStatRow("kickReturns", "YDS", 200, 2023),
            makeStatRow("puntReturns", "YDS", 100, 2023),
        ] });

        const result = await getPlayerStats(3, FAKE_ENV);
        expect(result["Kick Returns"]).toBeDefined();
        expect(result["Punt Returns"]).toBeDefined();
        expect(result.kickReturns).toBeUndefined();
        expect(result.puntReturns).toBeUndefined();
    });
});
