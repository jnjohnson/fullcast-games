import { env } from "cloudflare:test";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getPlayers, checkAnswer } from "../server/transferWizard.js";
import * as cfbd from "../server/cfbd.js";

vi.mock("../server/cfbd.js");

// Minimal transfer record returned by fetchRandomTransfers
function makeTransfer(firstName, lastName, position, fromSchool, toSchool) {
  return {
    firstName,
    lastName,
    position: { position },
    fromTeam: { school: fromSchool },
    toTeam: { school: toSchool },
  };
}

// Mock env: CFBD_TOKEN is unused (cfbdGql is mocked), CFBD_CACHE is the real test KV binding.
function mockEnv() {
  return { CFBD_TOKEN: "Bearer test", CFBD_CACHE: env.CFBD_CACHE };
}

// Four distinct QB transfers into P4 schools — satisfies easy/medium difficulty.
const FOUR_QB_TRANSFERS = [
  makeTransfer("Alpha", "One",   "QB", "New Mexico", "Alabama"),
  makeTransfer("Beta",  "Two",   "QB", "UTSA",       "Georgia"),
  makeTransfer("Gamma", "Three", "QB", "FIU",        "Texas"),
  makeTransfer("Delta", "Four",  "QB", "UAB",        "Ohio State"),
];

// Full transfer history returned by GetTransferRecord for Alpha One
const ALPHA_ONE_HISTORY = [
  { season: 2024, fromTeam: { school: "New Mexico" }, toTeam: { school: "Alabama" } },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getPlayers", () => {
  it("returns 200 with a question array and 4 players", async () => {
    cfbd.cfbdGql
      .mockResolvedValueOnce({ transfer: FOUR_QB_TRANSFERS }) // fetchRandomTransfers
      .mockResolvedValueOnce({ transfer: ALPHA_ONE_HISTORY }); // GetTransferRecord

    const res = await getPlayers(mockEnv(), "easy");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.question)).toBe(true);
    expect(body.question.length).toBeGreaterThanOrEqual(1);
    expect(body.players).toHaveLength(4);
  });

  it("player IDs are formatted as FirstName_LastName_Position", async () => {
    cfbd.cfbdGql
      .mockResolvedValueOnce({ transfer: FOUR_QB_TRANSFERS })
      .mockResolvedValueOnce({ transfer: ALPHA_ONE_HISTORY });

    const res = await getPlayers(mockEnv(), "easy");
    const { players } = await res.json();

    for (const player of players) {
      expect(player.id).toMatch(/^\S+_\S+_\S+$/);
    }
  });

  it("question entries have a team field, and non-first entries have a season", async () => {
    cfbd.cfbdGql
      .mockResolvedValueOnce({ transfer: FOUR_QB_TRANSFERS })
      .mockResolvedValueOnce({
        transfer: [
          { season: 2024, fromTeam: { school: "New Mexico" }, toTeam: { school: "Alabama" } },
          { season: 2025, fromTeam: { school: "Alabama" },    toTeam: { school: "Georgia" } },
        ],
      });

    const res = await getPlayers(mockEnv(), "easy");
    const { question } = await res.json();

    expect(question[0]).toHaveProperty("team");
    expect(question[0]).not.toHaveProperty("season"); // first entry is origin, no season
    for (const stop of question.slice(1)) {
      expect(stop).toHaveProperty("team");
      expect(stop).toHaveProperty("season");
    }
  });

  it("returns 404 when GraphQL returns no transfers", async () => {
    cfbd.cfbdGql.mockResolvedValueOnce({ transfer: [] });

    const res = await getPlayers(mockEnv(), "easy");
    expect(res.status).toBe(404);
  });

  it("caches the question in KV so checkAnswer can verify it", async () => {
    cfbd.cfbdGql
      .mockResolvedValueOnce({ transfer: FOUR_QB_TRANSFERS })
      .mockResolvedValueOnce({ transfer: ALPHA_ONE_HISTORY });

    const getRes = await getPlayers(mockEnv(), "easy");
    const { question } = await getRes.json();

    // checkAnswer should resolve without 404 (i.e., find the KV entry)
    const submitReq = new Request("http://fake/api/transfer-wizard/submit", {
      method: "POST",
      body: JSON.stringify({ question }),
    });
    const submitRes = await checkAnswer(submitReq, mockEnv());
    expect(submitRes.status).toBe(200);
  });

  it("easy difficulty passes QB + toTeam school filter to the GraphQL query", async () => {
    cfbd.cfbdGql
      .mockResolvedValueOnce({ transfer: FOUR_QB_TRANSFERS })
      .mockResolvedValueOnce({ transfer: ALPHA_ONE_HISTORY });

    await getPlayers(mockEnv(), "easy");

    const { where } = cfbd.cfbdGql.mock.calls[0][1];
    expect(where.position.position._eq).toBe("QB");
    expect(Array.isArray(where.toTeam.school._in)).toBe(true);
  });

  it("medium difficulty passes QB/RB/WR position filter", async () => {
    cfbd.cfbdGql
      .mockResolvedValueOnce({ transfer: FOUR_QB_TRANSFERS })
      .mockResolvedValueOnce({ transfer: ALPHA_ONE_HISTORY });

    await getPlayers(mockEnv(), "medium");

    const { where } = cfbd.cfbdGql.mock.calls[0][1];
    expect(where.position.position._in).toEqual(expect.arrayContaining(["QB", "RB", "WR"]));
  });

  it("hard difficulty passes no position filter", async () => {
    cfbd.cfbdGql
      .mockResolvedValueOnce({ transfer: FOUR_QB_TRANSFERS })
      .mockResolvedValueOnce({ transfer: ALPHA_ONE_HISTORY });

    await getPlayers(mockEnv(), "hard");

    const { where } = cfbd.cfbdGql.mock.calls[0][1];
    expect(where).not.toHaveProperty("position");
  });

  it("retries to the next candidate when the first has a degenerate chain (from == to)", async () => {
    // First candidate's GetTransferRecord returns from == to (length-1 chain)
    // Second candidate's GetTransferRecord returns a valid 2-stop chain
    cfbd.cfbdGql
      .mockResolvedValueOnce({ transfer: FOUR_QB_TRANSFERS })           // fetchRandomTransfers
      .mockResolvedValueOnce({ transfer: [                               // GetTransferRecord call 1: degenerate
          { season: 2024, fromTeam: { school: "Alabama" }, toTeam: { school: "Alabama" } },
        ] })
      .mockResolvedValueOnce({ transfer: ALPHA_ONE_HISTORY });           // GetTransferRecord call 2: valid

    const res = await getPlayers(mockEnv(), "easy");
    expect(res.status).toBe(200);
    const { question } = await res.json();
    expect(question.length).toBeGreaterThanOrEqual(2);
  });

  it("returns 404 when all 4 candidates have degenerate chains", async () => {
    const degenerateHistory = [{ season: 2024, fromTeam: { school: "X" }, toTeam: null }];
    cfbd.cfbdGql
      .mockResolvedValueOnce({ transfer: FOUR_QB_TRANSFERS })
      .mockResolvedValueOnce({ transfer: degenerateHistory })
      .mockResolvedValueOnce({ transfer: degenerateHistory })
      .mockResolvedValueOnce({ transfer: degenerateHistory })
      .mockResolvedValueOnce({ transfer: degenerateHistory });

    const res = await getPlayers(mockEnv(), "easy");
    expect(res.status).toBe(404);
  });

  it("question contains 4 stops when fromTeam[1] differs from toTeam[0] (chain gap)", async () => {
    cfbd.cfbdGql
      .mockResolvedValueOnce({ transfer: FOUR_QB_TRANSFERS })
      .mockResolvedValueOnce({
        transfer: [
          { season: 2023, fromTeam: { school: "Clemson" },        toTeam: { school: "South Carolina" } },
          { season: 2024, fromTeam: { school: "Florida" },         toTeam: { school: "Tennessee" } },
        ],
      });

    const res = await getPlayers(mockEnv(), "easy");
    const { question } = await res.json();
    expect(question).toEqual([
      { team: "Clemson" },
      { season: 2023, team: "South Carolina" },
      { season: 2024, team: "Florida" },
      { season: 2024, team: "Tennessee" },
    ]);
  });

  it("sickos difficulty passes no position or school filter", async () => {
    cfbd.cfbdGql
      .mockResolvedValueOnce({ transfer: FOUR_QB_TRANSFERS })
      .mockResolvedValueOnce({ transfer: ALPHA_ONE_HISTORY });

    await getPlayers(mockEnv(), "sickos");

    const { where } = cfbd.cfbdGql.mock.calls[0][1];
    expect(where).not.toHaveProperty("position");
    expect(where).not.toHaveProperty("toTeam");
  });
});

describe("checkAnswer", () => {
  it("returns pid matching the player cached from getPlayers", async () => {
    cfbd.cfbdGql
      .mockResolvedValueOnce({ transfer: FOUR_QB_TRANSFERS })
      .mockResolvedValueOnce({ transfer: ALPHA_ONE_HISTORY });

    const getRes = await getPlayers(mockEnv(), "easy");
    const { question, players } = await getRes.json();

    const submitReq = new Request("http://fake/api/transfer-wizard/submit", {
      method: "POST",
      body: JSON.stringify({ question }),
    });
    const submitRes = await checkAnswer(submitReq, mockEnv());
    const { pid } = await submitRes.json();

    // pid must be one of the player IDs returned by getPlayers
    const validIds = players.map((p) => p.id);
    expect(pid).toHaveLength(1);
    expect(validIds).toContain(pid[0]);
  });

  it("returns 404 when the question was never cached", async () => {
    const req = new Request("http://fake/api/transfer-wizard/submit", {
      method: "POST",
      body: JSON.stringify({ question: [{ team: "Nowhere" }, { season: 1900, team: "Nowhere" }] }),
    });
    const res = await checkAnswer(req, mockEnv());
    expect(res.status).toBe(404);
  });
});

describe("Routing", () => {
  it("unknown API path returns 404", async () => {
    const res = await fetch("http://localhost:5174/api/unknown-endpoint");
    expect(res.status).toBe(404);
  });
});
