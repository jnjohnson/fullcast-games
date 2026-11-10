import { env } from "cloudflare:test";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import worker from "../server/index.js";
import { getQuestion, submitAnswer, useLifeline, search, offseasonYear, MAX_MISSES } from "../server/ladder.js";
import * as cfbd from "../server/cfbd.js";

vi.mock("../server/cfbd.js");

// Mock env: CFBD_TOKEN is unused (cfbdGql is mocked), CFBD_CACHE is the real test KV binding.
function mockEnv() {
  return { CFBD_TOKEN: "Bearer test", CFBD_CACHE: env.CFBD_CACHE };
}

// Response from the poll query in getRankedTeams
const POLL = {
  poll: [{
    season: 2025,
    seasonType: "postseason",
    week: 1,
    rankings: [{ rank: 1, team: { school: "Ohio State" } }],
  }],
};

// Response from the game query in subjectGames: Ohio State's last game, a loss to Indiana
const GAMES = {
  game: [{
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
  }],
};

// Response from fetchGameContext: passing rows and coaches for that game
const CONTEXT = {
  gamePlayerStat: [
    { stat: "20/30", athlete: { id: 10, name: "Julian Sayin", position: { abbreviation: "QB" } }, gameTeam: { gameId: 1, teamId: 194 } },
    { stat: "15/23", athlete: { id: 20, name: "Fernando Mendoza", position: { abbreviation: "QB" } }, gameTeam: { gameId: 1, teamId: 84 } },
  ],
  coachSeason: [
    { year: 2025, team: { school: "Ohio State" }, coach: { id: 1, firstName: "Ryan", lastName: "Day" } },
    { year: 2025, team: { school: "Indiana" }, coach: { id: 2, firstName: "Curt", lastName: "Cignetti" } },
  ],
};

// A full cached question, as getQuestion stores it in KV
function cachedQuestion(overrides = {}) {
  return {
    subject: { kind: "team", id: "Ohio State", name: "Ohio State", detail: "No. 1 AP" },
    direction: "beatBy",
    answerKind: "coach",
    answer: { kind: "coach", id: 2, name: "Curt Cignetti", detail: "Indiana" },
    game: { date: "2025-12-06T20:00:00", score: "Indiana 13, Ohio State 10" },
    run: { score: 0, misses: 0, lifelineUsed: false, usedKeys: ["team:Ohio State"] },
    solved: false,
    choices: null,
    ...overrides,
  };
}

// Stores a question in KV and returns its id
async function putQuestion(question) {
  const id = crypto.randomUUID();
  await env.CFBD_CACHE.put(`ladder:q:${id}`, JSON.stringify(question));
  return id;
}

function post(path, body) {
  return new Request(`http://fake/api/ladder/${path}`, { method: "POST", body: JSON.stringify(body) });
}

beforeEach(async () => {
  vi.clearAllMocks();
  // Cached rankings, games and indexes would change the cfbdGql call order, so clear every ladder key.
  const { keys } = await env.CFBD_CACHE.list({ prefix: "ladder:" });
  await Promise.all(keys.map(({ name }) => env.CFBD_CACHE.delete(name)));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getQuestion", () => {
  it("starts a run from a ranked team without revealing the answer", async () => {
    // Math.random() = 0 picks the first ranked team, the 'team' start kind, and tries beatBy/coach first.
    vi.spyOn(Math, "random").mockReturnValue(0);
    cfbd.cfbdGql
      .mockResolvedValueOnce(POLL)
      .mockResolvedValueOnce(GAMES)
      .mockResolvedValueOnce(CONTEXT);

    const res = await getQuestion(new Request("http://fake/api/ladder/question"), mockEnv());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      subject: { kind: "team", name: "Ohio State", detail: "No. 1 AP" },
      direction: "beatBy",
      answerKind: "coach",
      run: { score: 0, misses: 0, lifelineUsed: false },
      choices: null,
      restarted: false,
    });
    expect(body.answer).toBeUndefined();

    const cached = await env.CFBD_CACHE.get(`ladder:q:${body.id}`, { type: "json" });
    expect(cached.answer).toEqual({ kind: "coach", id: 2, name: "Curt Cignetti", detail: "Indiana" });
    expect(cached.run.usedKeys).toEqual(["team:Ohio State"]);
    expect(cached.run.usedGameIds).toEqual([1]);
  });

  it("caches the rankings and the subject's games for the offseason", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    cfbd.cfbdGql
      .mockResolvedValueOnce(POLL)
      .mockResolvedValueOnce(GAMES)
      .mockResolvedValueOnce(CONTEXT);

    await getQuestion(new Request("http://fake/api/ladder/question"), mockEnv());
    await getQuestion(new Request("http://fake/api/ladder/question"), mockEnv());

    const year = offseasonYear();
    expect(await env.CFBD_CACHE.get(`ladder:ranked:${year}`, { type: "json" })).toHaveLength(1);
    expect(await env.CFBD_CACHE.get(`ladder:games:team:Ohio State:${year}`, { type: "json" })).toHaveLength(1);
    expect(cfbd.cfbdGql).toHaveBeenCalledTimes(3);
  });

  it("returns 404 when continuing from an expired question", async () => {
    const res = await getQuestion(new Request("http://fake/api/ladder/question?from=missing"), mockEnv());
    expect(res.status).toBe(404);
  });

  it("returns 400 when continuing from an unsolved question", async () => {
    const id = await putQuestion(cachedQuestion());
    const res = await getQuestion(new Request(`http://fake/api/ladder/question?from=${id}`), mockEnv());
    expect(res.status).toBe(400);
  });

  it("makes the previous answer the next subject and carries the run forward", async () => {
    // Indiana is the next subject; its cached games show a win over Ohio State.
    const year = offseasonYear();
    await env.CFBD_CACHE.put(`ladder:games:team:Indiana:${year}`, JSON.stringify([{
      gameId: 7,
      won: true,
      date: "2025-12-06T20:00:00",
      score: "Indiana 13, Ohio State 10",
      opponent: { team: { id: "Ohio State", name: "Ohio State", detail: "" }, coach: null, qb: null },
    }]));
    const id = await putQuestion(cachedQuestion({
      answerKind: "team",
      answer: { kind: "team", id: "Indiana", name: "Indiana", detail: "" },
      run: { score: 3, misses: 2, lifelineUsed: true, usedKeys: ["coach:9"], usedGameIds: [1] },
      solved: true,
    }));

    const res = await getQuestion(new Request(`http://fake/api/ladder/question?from=${id}`), mockEnv());
    const body = await res.json();

    expect(body).toMatchObject({
      subject: { kind: "team", name: "Indiana" },
      direction: "beat",
      answerKind: "team",
      run: { score: 3, misses: 2, lifelineUsed: true },
      restarted: false,
    });
    expect(cfbd.cfbdGql).not.toHaveBeenCalled();

    const cached = await env.CFBD_CACHE.get(`ladder:q:${body.id}`, { type: "json" });
    expect(cached.run.usedGameIds).toEqual([1, 7]);
  });
});

describe("submitAnswer", () => {
  it("solves the question and reveals the answer on a correct guess", async () => {
    const id = await putQuestion(cachedQuestion());
    const res = await submitAnswer(post("answer", { id, guessId: 2 }), mockEnv());
    const body = await res.json();

    expect(body).toEqual({
      correct: true,
      gameOver: false,
      run: { score: 1, misses: 0, lifelineUsed: false },
      answer: { name: "Curt Cignetti", detail: "Indiana" },
      game: { date: "2025-12-06T20:00:00", score: "Indiana 13, Ohio State 10" },
    });
    expect((await env.CFBD_CACHE.get(`ladder:q:${id}`, { type: "json" })).solved).toBe(true);
  });

  it("matches team ids given as strings", async () => {
    const id = await putQuestion(cachedQuestion({ answer: { kind: "team", id: "Indiana", name: "Indiana" } }));
    const body = await (await submitAnswer(post("answer", { id, guessId: "Indiana" }), mockEnv())).json();
    expect(body.correct).toBe(true);
  });

  it("adds a miss and hides the answer on a wrong guess", async () => {
    const id = await putQuestion(cachedQuestion());
    const body = await (await submitAnswer(post("answer", { id, guessId: 99 }), mockEnv())).json();

    expect(body).toEqual({ correct: false, gameOver: false, run: { score: 0, misses: 1, lifelineUsed: false } });
  });

  it("ends the run and reveals the answer on the last miss", async () => {
    const run = { score: 4, misses: MAX_MISSES - 1, lifelineUsed: true, usedKeys: [] };
    const id = await putQuestion(cachedQuestion({ run }));
    const body = await (await submitAnswer(post("answer", { id, guessId: 99 }), mockEnv())).json();

    expect(body.gameOver).toBe(true);
    expect(body.answer.name).toBe("Curt Cignetti");

    const again = await submitAnswer(post("answer", { id, guessId: 2 }), mockEnv());
    expect(again.status).toBe(400);
  });

  it("returns 400 for a missing guess and 404 for an expired question", async () => {
    const id = await putQuestion(cachedQuestion());
    expect((await submitAnswer(post("answer", { id }), mockEnv())).status).toBe(400);
    expect((await submitAnswer(post("answer", { id: "missing", guessId: 2 }), mockEnv())).status).toBe(404);
  });
});

describe("useLifeline", () => {
  it("returns the answer and distractors from the subject's other losses, once per run", async () => {
    const loss = (id, name) => ({
      won: false,
      opponent: { team: null, qb: null, coach: { id, name, detail: "School" } },
    });
    await env.CFBD_CACHE.put(`ladder:games:team:Ohio State:${offseasonYear()}`, JSON.stringify([
      loss(2, "Curt Cignetti"), loss(3, "Sherrone Moore"), loss(4, "Steve Sarkisian"), loss(5, "Dan Lanning"),
    ]));
    const id = await putQuestion(cachedQuestion());

    const body = await (await useLifeline(post("lifeline", { id }), mockEnv())).json();
    expect(body.choices).toHaveLength(4);
    expect(body.choices.map(c => c.id).sort()).toEqual([2, 3, 4, 5]);
    expect(cfbd.cfbdGql).not.toHaveBeenCalled();

    const cached = await env.CFBD_CACHE.get(`ladder:q:${id}`, { type: "json" });
    expect(cached.run.lifelineUsed).toBe(true);
    expect((await useLifeline(post("lifeline", { id }), mockEnv())).status).toBe(400);
  });

  it("returns 404 for an expired question", async () => {
    expect((await useLifeline(post("lifeline", { id: "missing" }), mockEnv())).status).toBe(404);
  });
});

describe("search", () => {
  it("returns 400 for an unknown kind and [] for short queries", async () => {
    expect((await search(new Request("http://fake/api/ladder/search?kind=kicker&q=abc"), mockEnv())).status).toBe(400);
    const res = await search(new Request("http://fake/api/ladder/search?kind=team&q=a"), mockEnv());
    expect(await res.json()).toEqual([]);
  });

  it("builds the team index once and searches it", async () => {
    cfbd.cfbdGql.mockResolvedValueOnce({
      currentTeams: [
        { school: "Iowa", conference: "Big Ten", classification: "fbs" },
        { school: "Iowa State", conference: "Big 12", classification: "fbs" },
        { school: "Northern Iowa", conference: null, classification: "fcs" },
        { school: "Texas", conference: "SEC", classification: "fbs" },
      ],
    });

    const res = await search(new Request("http://fake/api/ladder/search?kind=team&q=iowa"), mockEnv());
    expect(await res.json()).toEqual([
      { id: "Iowa", name: "Iowa", detail: "Big Ten" },
      { id: "Iowa State", name: "Iowa State", detail: "Big 12" },
      { id: "Northern Iowa", name: "Northern Iowa", detail: "FCS" },
    ]);

    await search(new Request("http://fake/api/ladder/search?kind=team&q=tex"), mockEnv());
    expect(cfbd.cfbdGql).toHaveBeenCalledTimes(1);
  });
});

describe("routing", () => {
  it("routes ladder endpoints and requires POST for answers", async () => {
    const id = await putQuestion(cachedQuestion());

    const answer = await worker.fetch(post("answer", { id, guessId: 2 }), mockEnv());
    expect((await answer.json()).correct).toBe(true);

    const get = await worker.fetch(new Request("http://fake/api/ladder/answer"), mockEnv());
    expect(get.status).toBe(404);

    const searchRes = await worker.fetch(new Request("http://fake/api/ladder/search?kind=coach&q=x"), mockEnv());
    expect(await searchRes.json()).toEqual([]);
  });
});
