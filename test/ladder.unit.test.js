import { describe, it, expect } from "vitest";
import {
  offseasonYear,
  subjectKey,
  predictStartingQB,
  toGameEntry,
  findAnswer,
  chooseQuestion,
  latestPoll,
  searchIndex,
} from "../server/ladder.js";

// A passing C/ATT row, as fetchGameContext loads them
function passRow(teamId, id, name, stat, position = "QB") {
  return { stat, athlete: { id, name, position: { abbreviation: position } }, gameTeam: { teamId } };
}

// A CFBD game between Ohio State (home, id 194) and Indiana (away, id 84)
function game(overrides = {}) {
  return {
    id: 1,
    season: 2025,
    startDate: "2025-12-06T20:00:00",
    homeTeam: "Ohio State",
    homeTeamId: 194,
    homePoints: 10,
    homeClassification: "fbs",
    awayTeam: "Indiana",
    awayTeamId: 84,
    awayPoints: 13,
    awayClassification: "fbs",
    ...overrides,
  };
}

const STARTERS = {
  194: { id: 10, name: "Julian Sayin", position: "QB" },
  84: { id: 20, name: "Fernando Mendoza", position: "QB" },
};
const COACHES = {
  "2025|Ohio State": [{ id: 1, name: "Ryan Day" }],
  "2025|Indiana": [{ id: 2, name: "Curt Cignetti" }],
};

// A game entry from the subject's side, for findAnswer / chooseQuestion
function entry(won, opponent, date = "2025-01-01") {
  return { won, date, score: "x", opponent };
}
const OPP = {
  team: { id: "Indiana", name: "Indiana", detail: "" },
  coach: { id: 2, name: "Curt Cignetti", detail: "Indiana" },
  qb: { id: 20, name: "Fernando Mendoza", detail: "Indiana" },
};

// ─── offseasonYear ───────────────────────────────────────────────────────────

describe("offseasonYear", () => {
  it("returns the previous year in January", () => {
    expect(offseasonYear(new Date("2027-01-15T12:00:00Z"))).toBe(2026);
  });

  it("returns the current year from February on", () => {
    expect(offseasonYear(new Date("2027-02-01T12:00:00Z"))).toBe(2027);
    expect(offseasonYear(new Date("2027-08-20T12:00:00Z"))).toBe(2027);
  });
});

// ─── predictStartingQB ───────────────────────────────────────────────────────

describe("predictStartingQB", () => {
  it("picks the player with the most attempts on each team", () => {
    const starters = predictStartingQB([
      passRow(66, 1, "Backup", "2/2", "RB"),
      passRow(66, 2, "Starter", "19/27"),
      passRow(277, 3, "Other Starter", "11/23"),
    ]);
    expect(starters[66]).toEqual({ id: 2, name: "Starter", position: "QB" });
    expect(starters[277].id).toBe(3);
  });

  it("keeps the first player on a tie", () => {
    const starters = predictStartingQB([passRow(66, 1, "A", "5/10"), passRow(66, 2, "B", "6/10")]);
    expect(starters[66].id).toBe(1);
  });

  it("treats unparseable stats as 0 attempts", () => {
    const starters = predictStartingQB([passRow(66, 1, "A", "--"), passRow(66, 2, "B", "1/1")]);
    expect(starters[66].id).toBe(2);
  });
});

// ─── toGameEntry ─────────────────────────────────────────────────────────────

describe("toGameEntry", () => {
  it("builds both sides from the subject's point of view", () => {
    const e = toGameEntry(game(), "Ohio State", STARTERS, COACHES);
    expect(e.won).toBe(false);
    expect(e.score).toBe("Indiana 13, Ohio State 10");
    expect(e.self.coach).toEqual({ id: 1, name: "Ryan Day", detail: "Ohio State" });
    expect(e.opponent.team).toEqual({ id: "Indiana", name: "Indiana", detail: "" });
    expect(e.opponent.coach.id).toBe(2);
    expect(e.opponent.qb).toEqual({ id: 20, name: "Fernando Mendoza", detail: "Indiana" });
  });

  it("marks a win for the away side", () => {
    expect(toGameEntry(game(), "Indiana", STARTERS, COACHES).won).toBe(true);
  });

  it("returns null for ties and unplayed games", () => {
    expect(toGameEntry(game({ homePoints: 13 }), "Indiana", STARTERS, COACHES)).toBeNull();
    expect(toGameEntry(game({ homePoints: null }), "Indiana", STARTERS, COACHES)).toBeNull();
  });

  it("leaves out answers that can't be confirmed", () => {
    const e = toGameEntry(
      game({ awayClassification: "ii" }),
      "Ohio State",
      { 194: STARTERS[194], 84: { id: 21, name: "Wildcat", position: "RB" } },
      { ...COACHES, "2025|Indiana": [{ id: 2, name: "A" }, { id: 3, name: "B" }] }
    );
    expect(e.opponent.team).toBeNull();
    expect(e.opponent.coach).toBeNull();
    expect(e.opponent.qb).toBeNull();
  });
});

// ─── findAnswer / chooseQuestion ─────────────────────────────────────────────

describe("findAnswer", () => {
  const games = [entry(true, { ...OPP, team: { id: "Purdue", name: "Purdue" } }), entry(false, OPP)];

  it("uses the last loss for beatBy and the last win for beat", () => {
    expect(findAnswer(games, "beatBy", "team", []).answer.id).toBe("Indiana");
    expect(findAnswer(games, "beat", "team", []).answer.id).toBe("Purdue");
  });

  it("returns null when the answer was already used", () => {
    expect(findAnswer(games, "beatBy", "coach", [subjectKey("coach", 2)])).toBeNull();
  });

  it("doesn't fall back to an older game when the last one has no answer", () => {
    const withGap = [entry(false, { ...OPP, coach: null }), entry(false, OPP)];
    expect(findAnswer(withGap, "beatBy", "coach", [])).toBeNull();
  });

  it("returns null when the subject has no matching game", () => {
    expect(findAnswer([entry(true, OPP)], "beatBy", "team", [])).toBeNull();
  });
});

describe("chooseQuestion", () => {
  it("returns the first pairing that has an answer", () => {
    const games = [entry(false, { ...OPP, qb: null })];
    const q = chooseQuestion(games, [], [
      { direction: "beat", answerKind: "team" },
      { direction: "beatBy", answerKind: "qb" },
      { direction: "beatBy", answerKind: "coach" },
    ]);
    expect(q).toMatchObject({ direction: "beatBy", answerKind: "coach", answer: { kind: "coach", id: 2 } });
  });

  it("returns null when the chain dead-ends", () => {
    expect(chooseQuestion([entry(false, OPP)], ["team:Indiana", "coach:2", "qb:20"])).toBeNull();
  });
});

// ─── latestPoll ──────────────────────────────────────────────────────────────

describe("latestPoll", () => {
  it("prefers the latest season's postseason poll", () => {
    const polls = [
      { season: 2025, seasonType: "regular", week: 15 },
      { season: 2025, seasonType: "postseason", week: 1 },
      { season: 2024, seasonType: "postseason", week: 1 },
    ];
    expect(latestPoll(polls)).toBe(polls[1]);
  });

  it("falls back to the latest regular season week", () => {
    const polls = [
      { season: 2026, seasonType: "regular", week: 5 },
      { season: 2026, seasonType: "regular", week: 6 },
      { season: 2025, seasonType: "postseason", week: 1 },
    ];
    expect(latestPoll(polls)).toBe(polls[1]);
  });
});

// ─── searchIndex ─────────────────────────────────────────────────────────────

describe("searchIndex", () => {
  const index = [
    { id: 1, name: "Kane Archer" },
    { id: 2, name: "Nicco Marchiol" },
    { id: 3, name: "Arch Manning" },
    { id: 4, name: "Texas A&M" },
    { id: 5, name: "José Martínez" },
  ];

  it("ranks prefix matches, then word matches, then substring matches", () => {
    expect(searchIndex(index, "arch").map(e => e.id)).toEqual([3, 1, 2]);
  });

  it("ignores case, accents and punctuation", () => {
    expect(searchIndex(index, "TEXAS AM").map(e => e.id)).toEqual([4]);
    expect(searchIndex(index, "martinez").map(e => e.id)).toEqual([5]);
  });

  it("limits the results and returns [] for an empty query", () => {
    expect(searchIndex(index, "a", 2)).toHaveLength(2);
    expect(searchIndex(index, "  ")).toEqual([]);
  });
});
