import { env } from "cloudflare:test";
import { describe, it, expect, vi, beforeEach } from "vitest";
import worker from "../server/index.js";
import { getQuestion, submitAnswer } from "../server/moreOrLess.js";
import * as cfbd from "../server/cfbd.js";

vi.mock("../server/cfbd.js");

// Mock env: CFBD_TOKEN is unused (cfbdGql is mocked), CFBD_CACHE is the real test KV binding.
function mockEnv() {
  return { CFBD_TOKEN: "Bearer test", CFBD_CACHE: env.CFBD_CACHE };
}

// Response from the `coach` query in pickCoaches
function coachRow(id, firstName, lastName, school, wins, losses) {
  return {
    coach: [{
      id,
      firstName,
      lastName,
      seasons: [{ team: { school } }],
      seasonsAggregate: { aggregate: { sum: { wins, losses, ties: 0 } } },
    }],
  };
}

const COACH_COUNT = { coachAggregate: { aggregate: { count: 300 } } };

// A full cached coach question, as getQuestion stores it in KV
function cachedCoachQuestion(aValue, bValue) {
  return {
    type: "coach",
    stat: { key: "winPct", label: "win % since 2000" },
    a: { id: 1, name: "Dabo Swinney", detail: "Clemson", value: aValue, display: "a" },
    b: { id: 2, name: "Jimbo Fisher", detail: "Texas A&M", value: bValue, display: "b" },
  };
}

// Stores a question in KV and returns its id
async function putQuestion(question) {
  const id = crypto.randomUUID();
  await env.CFBD_CACHE.put(`mol:q:${id}`, JSON.stringify(question));
  return id;
}

function answerRequest(body) {
  return new Request("http://fake/api/more-or-less/answer", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  // The coach count and draft pools are cached in KV; clear them so each test controls the cfbdGql call order.
  await Promise.all([
    env.CFBD_CACHE.delete("mol:coach-count"),
    ...["qb", "rb", "wr"].map(group => env.CFBD_CACHE.delete(`mol:draft:${group}`)),
  ]);
});

describe("getQuestion", () => {
  it("returns a fresh coach question without B's value", async () => {
    cfbd.cfbdGql
      .mockResolvedValueOnce(COACH_COUNT)
      .mockResolvedValueOnce(coachRow(1, "Dabo", "Swinney", "Clemson", 187, 53))
      .mockResolvedValueOnce(coachRow(2, "Jimbo", "Fisher", "Texas A&M", 128, 47));

    const res = await getQuestion(new Request("http://fake/api/more-or-less/question?type=coach"), mockEnv());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.type).toBe("coach");
    expect(body.stat).toEqual({ key: "winPct", label: "win % since 2000" });
    expect(body.a).toEqual({ name: "Dabo Swinney", detail: "Clemson", value: 187 / 240, display: ".779 (187-53)" });
    expect(body.b).toEqual({ name: "Jimbo Fisher", detail: "Texas A&M" });
  });

  it("caches the full question, including B's value, under its id", async () => {
    cfbd.cfbdGql
      .mockResolvedValueOnce(COACH_COUNT)
      .mockResolvedValueOnce(coachRow(1, "Dabo", "Swinney", "Clemson", 187, 53))
      .mockResolvedValueOnce(coachRow(2, "Jimbo", "Fisher", "Texas A&M", 128, 47));

    const res = await getQuestion(new Request("http://fake/api/more-or-less/question?type=coach"), mockEnv());
    const { id } = await res.json();
    const cached = await env.CFBD_CACHE.get(`mol:q:${id}`, { type: "json" });

    expect(cached.b.value).toBe(128 / 175);
  });

  it("caches the coach count and skips the count query while it's cached", async () => {
    cfbd.cfbdGql
      .mockResolvedValueOnce(COACH_COUNT)
      .mockResolvedValueOnce(coachRow(1, "Dabo", "Swinney", "Clemson", 187, 53))
      .mockResolvedValueOnce(coachRow(2, "Jimbo", "Fisher", "Texas A&M", 128, 47))
      // Second question: no count query, straight to the two coach queries
      .mockResolvedValueOnce(coachRow(3, "Nick", "Saban", "Alabama", 292, 64))
      .mockResolvedValueOnce(coachRow(4, "Kirby", "Smart", "Georgia", 115, 22));

    await getQuestion(new Request("http://fake/api/more-or-less/question?type=coach"), mockEnv());
    expect(await env.CFBD_CACHE.get("mol:coach-count", { type: "json" })).toBe(300);

    const res = await getQuestion(new Request("http://fake/api/more-or-less/question?type=coach"), mockEnv());
    const body = await res.json();

    expect(cfbd.cfbdGql).toHaveBeenCalledTimes(5);
    expect([body.a.name, body.b.name]).toEqual(["Nick Saban", "Kirby Smart"]);
  });

  it("re-rolls a coach that was already picked", async () => {
    cfbd.cfbdGql
      .mockResolvedValueOnce(COACH_COUNT)
      .mockResolvedValueOnce(coachRow(1, "Dabo", "Swinney", "Clemson", 187, 53))
      .mockResolvedValueOnce(coachRow(1, "Dabo", "Swinney", "Clemson", 187, 53))
      .mockResolvedValueOnce(coachRow(2, "Jimbo", "Fisher", "Texas A&M", 128, 47));

    const res = await getQuestion(new Request("http://fake/api/more-or-less/question?type=coach"), mockEnv());
    const body = await res.json();

    expect(body.b.name).toBe("Jimbo Fisher");
    expect(cfbd.cfbdGql).toHaveBeenCalledTimes(4);
  });

  it("returns a fresh school question with records since 2000", async () => {
    cfbd.cfbdGql
      .mockResolvedValueOnce({ coachSeasonAggregate: { aggregate: { sum: { wins: 225, losses: 103, ties: 0 } } } })
      .mockResolvedValueOnce({ coachSeasonAggregate: { aggregate: { sum: { wins: 260, losses: 60, ties: 0 } } } });

    const res = await getQuestion(new Request("http://fake/api/more-or-less/question?type=school"), mockEnv());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.type).toBe("school");
    expect(body.a.display).toBe(".686 (225-103)");
    expect(body.a.detail).toBe("Since 2000");
    expect(body.a.name).not.toBe(body.b.name);
    expect(body.b.value).toBeUndefined();
  });

  it("returns a fresh player question from the draft pool", async () => {
    cfbd.cfbdGql
      .mockResolvedValueOnce({ draftPicks: [
        { position: { abbreviation: "QB" }, collegeTeam: { school: "Alabama" }, collegeAthleteRecord: { id: 11, firstName: "Bryce", lastName: "Young" } },
        { position: { abbreviation: "QB" }, collegeTeam: { school: "Clemson" }, collegeAthleteRecord: { id: 12, firstName: "Trevor", lastName: "Lawrence" } },
        { position: { abbreviation: "QB" }, collegeTeam: { school: "Nowhere" }, collegeAthleteRecord: null },
      ] })
      .mockResolvedValueOnce({ gamePlayerStat: [{ stat: "100" }, { stat: "50" }] })
      .mockResolvedValueOnce({ gamePlayerStat: [{ stat: "70" }] });

    const res = await getQuestion(new Request("http://fake/api/more-or-less/question?type=player"), mockEnv());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.type).toBe("player");
    expect(body.a.value).toBe(150);
    expect(body.a.display).toBe("150");
    expect([body.a.name, body.b.name].sort()).toEqual(["Bryce Young", "Trevor Lawrence"]);
    expect(body.b.value).toBeUndefined();
  });

  it("reuses a cached draft pool without querying CFBD", async () => {
    await env.CFBD_CACHE.put("mol:draft:qb", JSON.stringify([
      { id: 11, name: "Bryce Young", detail: "QB · Alabama" },
      { id: 12, name: "Trevor Lawrence", detail: "QB · Clemson" },
    ]));
    await env.CFBD_CACHE.put("mol:draft:rb", JSON.stringify([
      { id: 21, name: "Bijan Robinson", detail: "RB · Texas" },
      { id: 22, name: "Jahmyr Gibbs", detail: "RB · Alabama" },
    ]));
    await env.CFBD_CACHE.put("mol:draft:wr", JSON.stringify([
      { id: 31, name: "Ja'Marr Chase", detail: "WR · LSU" },
      { id: 32, name: "DeVonta Smith", detail: "WR · Alabama" },
    ]));
    cfbd.cfbdGql
      .mockResolvedValueOnce({ gamePlayerStat: [{ stat: "100" }] })
      .mockResolvedValueOnce({ gamePlayerStat: [{ stat: "70" }] });

    const res = await getQuestion(new Request("http://fake/api/more-or-less/question?type=player"), mockEnv());

    expect(res.status).toBe(200);
    expect(cfbd.cfbdGql).toHaveBeenCalledTimes(2);
  });

  it("re-rolls a player whose total is 0", async () => {
    cfbd.cfbdGql
      .mockResolvedValueOnce({ draftPicks: [
        { position: { abbreviation: "RB" }, collegeTeam: { school: "A" }, collegeAthleteRecord: { id: 21, firstName: "One", lastName: "Back" } },
        { position: { abbreviation: "RB" }, collegeTeam: { school: "B" }, collegeAthleteRecord: { id: 22, firstName: "Two", lastName: "Back" } },
        { position: { abbreviation: "RB" }, collegeTeam: { school: "C" }, collegeAthleteRecord: { id: 23, firstName: "Three", lastName: "Back" } },
      ] })
      .mockResolvedValueOnce({ gamePlayerStat: [] })
      .mockResolvedValueOnce({ gamePlayerStat: [{ stat: "40" }] })
      .mockResolvedValueOnce({ gamePlayerStat: [{ stat: "30" }] });

    const res = await getQuestion(new Request("http://fake/api/more-or-less/question?type=player"), mockEnv());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.a.value).toBe(40);
  });

  it("continues a streak with the previous B as the new A", async () => {
    const from = await putQuestion(cachedCoachQuestion(0.779, 0.731));
    cfbd.cfbdGql
      .mockResolvedValueOnce(COACH_COUNT)
      .mockResolvedValueOnce(coachRow(3, "Nick", "Saban", "Alabama", 292, 64));

    const res = await getQuestion(new Request(`http://fake/api/more-or-less/question?from=${from}`), mockEnv());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).not.toBe(from);
    expect(body.a).toEqual({ name: "Jimbo Fisher", detail: "Texas A&M", value: 0.731, display: "b" });
    expect(body.b).toEqual({ name: "Nick Saban", detail: "Alabama" });
  });

  it("doesn't reuse either previous coach as the new B", async () => {
    const from = await putQuestion(cachedCoachQuestion(0.779, 0.731));
    cfbd.cfbdGql
      .mockResolvedValueOnce(COACH_COUNT)
      .mockResolvedValueOnce(coachRow(1, "Dabo", "Swinney", "Clemson", 187, 53))
      .mockResolvedValueOnce(coachRow(3, "Nick", "Saban", "Alabama", 292, 64));

    const res = await getQuestion(new Request(`http://fake/api/more-or-less/question?from=${from}`), mockEnv());
    const body = await res.json();

    expect(body.b.name).toBe("Nick Saban");
  });

  it("returns 404 when continuing from an expired question", async () => {
    const res = await getQuestion(new Request("http://fake/api/more-or-less/question?from=missing"), mockEnv());
    expect(res.status).toBe(404);
  });

  it("returns 500 when CFBD fails", async () => {
    cfbd.cfbdGql.mockRejectedValueOnce(new Error("CFBD GraphQL HTTP 500"));

    const res = await getQuestion(new Request("http://fake/api/more-or-less/question?type=coach"), mockEnv());
    expect(res.status).toBe(500);
  });
});

describe("submitAnswer", () => {
  it("marks a correct guess and reveals B", async () => {
    const id = await putQuestion(cachedCoachQuestion(0.7, 0.8));

    const res = await submitAnswer(answerRequest({ id, guess: "more" }), mockEnv());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ correct: true, b: { value: 0.8, display: "b" } });
  });

  it("marks a wrong guess", async () => {
    const id = await putQuestion(cachedCoachQuestion(0.7, 0.8));

    const res = await submitAnswer(answerRequest({ id, guess: "less" }), mockEnv());
    expect((await res.json()).correct).toBe(false);
  });

  it("returns 400 for an invalid guess", async () => {
    const id = await putQuestion(cachedCoachQuestion(0.7, 0.8));

    const res = await submitAnswer(answerRequest({ id, guess: "maybe" }), mockEnv());
    expect(res.status).toBe(400);
  });

  it("returns 404 for an expired question", async () => {
    const res = await submitAnswer(answerRequest({ id: "missing", guess: "more" }), mockEnv());
    expect(res.status).toBe(404);
  });
});

describe("routing", () => {
  it("routes POST /api/more-or-less/answer", async () => {
    const id = await putQuestion(cachedCoachQuestion(0.7, 0.8));

    const res = await worker.fetch(answerRequest({ id, guess: "more" }), mockEnv());
    expect(res.status).toBe(200);
  });

  it("routes GET /api/more-or-less/question", async () => {
    const res = await worker.fetch(new Request("http://fake/api/more-or-less/question?from=missing"), mockEnv());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Question not found" });
  });

  it("returns 404 for GET /api/more-or-less/answer", async () => {
    const res = await worker.fetch(new Request("http://fake/api/more-or-less/answer"), mockEnv());
    expect(res.status).toBe(404);
  });
});
