import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";

// Seed data designed so each difficulty filter has at least 4 matching rows:
//   easy   (QB + InP4=1):                       players 1,5,6,7,10  → 5 rows
//   medium (QB/RB/WR + InP4=1):                 players 1,2,5,6,7,9,10 → 7 rows
//   hard   (QB/RB/WR + WasInP4=1 OR InP4=1):   players 1,2,5,6,7,8,9,10 → 8 rows
//   sickos (all):                               all 10 rows
const TEST_PLAYERS = [
  { PlayerId: 1,  FirstName: "Alpha",   LastName: "One",   Position: "QB", WasInP4: 0, InP4: 1, Transfers: '["New Mexico","Alabama"]' },
  { PlayerId: 2,  FirstName: "Beta",    LastName: "Two",   Position: "RB", WasInP4: 1, InP4: 1, Transfers: '["Ohio State","Georgia"]' },
  { PlayerId: 3,  FirstName: "Gamma",   LastName: "Three", Position: "WR", WasInP4: 0, InP4: 0, Transfers: '["UTSA","Memphis"]' },
  { PlayerId: 4,  FirstName: "Delta",   LastName: "Four",  Position: "TE", WasInP4: 0, InP4: 0, Transfers: '["FIU","UAB"]' },
  { PlayerId: 5,  FirstName: "Epsilon", LastName: "Five",  Position: "QB", WasInP4: 1, InP4: 1, Transfers: '["Texas","USC"]' },
  { PlayerId: 6,  FirstName: "Zeta",    LastName: "Six",   Position: "QB", WasInP4: 1, InP4: 1, Transfers: '["Texas","USC"]' },
  { PlayerId: 7,  FirstName: "Eta",     LastName: "Seven", Position: "QB", WasInP4: 1, InP4: 1, Transfers: '["Michigan","Oregon"]' },
  { PlayerId: 8,  FirstName: "Theta",   LastName: "Eight", Position: "RB", WasInP4: 1, InP4: 0, Transfers: '["Nebraska","UTSA"]' },
  { PlayerId: 9,  FirstName: "Iota",    LastName: "Nine",  Position: "WR", WasInP4: 1, InP4: 1, Transfers: '["Penn State","Florida"]' },
  { PlayerId: 10, FirstName: "Kappa",   LastName: "Ten",   Position: "QB", WasInP4: 0, InP4: 1, Transfers: '["FIU","Alabama"]' },
];

beforeAll(async () => {
  await env.games_db
    .prepare(
      "CREATE TABLE IF NOT EXISTS PlayerTransfers (PlayerId INTEGER PRIMARY KEY, FirstName TEXT, LastName TEXT, Position TEXT, WasInP4 INTEGER, InP4 INTEGER, Transfers TEXT)"
    )
    .run();
  for (const p of TEST_PLAYERS) {
    await env.games_db
      .prepare(
        "INSERT OR REPLACE INTO PlayerTransfers (PlayerId, FirstName, LastName, Position, WasInP4, InP4, Transfers) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(p.PlayerId, p.FirstName, p.LastName, p.Position, p.WasInP4, p.InP4, p.Transfers)
      .run();
  }
});

describe("GET /api/transfer-wizard/get-players", () => {
  it("returns 200 with a question string and 4 players", async () => {
    const res = await SELF.fetch("http://fake-host/api/transfer-wizard/get-players");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.question).toBeTypeOf("string");
    expect(JSON.parse(body.question)).toHaveLength(2);
    expect(body.players).toHaveLength(4);
  });

  it("easy difficulty only returns QB players currently in P4", async () => {
    const res = await SELF.fetch("http://fake-host/api/transfer-wizard/get-players?difficulty=easy");
    expect(res.status).toBe(200);
    const { players } = await res.json();
    expect(players).toHaveLength(4);
    for (const player of players) {
      const { results } = await env.games_db
        .prepare("SELECT Position, InP4 FROM PlayerTransfers WHERE PlayerId = ?")
        .bind(player.id)
        .run();
      expect(results[0].Position).toBe("QB");
      expect(results[0].InP4).toBe(1);
    }
  });

  it("medium difficulty only returns QB/RB/WR players currently in P4", async () => {
    const res = await SELF.fetch("http://fake-host/api/transfer-wizard/get-players?difficulty=medium");
    expect(res.status).toBe(200);
    const { players } = await res.json();
    expect(players).toHaveLength(4);
    for (const player of players) {
      const { results } = await env.games_db
        .prepare("SELECT Position, InP4 FROM PlayerTransfers WHERE PlayerId = ?")
        .bind(player.id)
        .run();
      expect(["QB", "RB", "WR"]).toContain(results[0].Position);
      expect(results[0].InP4).toBe(1);
    }
  });

  it("hard difficulty only returns QB/RB/WR with any P4 history", async () => {
    const res = await SELF.fetch("http://fake-host/api/transfer-wizard/get-players?difficulty=hard");
    expect(res.status).toBe(200);
    const { players } = await res.json();
    expect(players).toHaveLength(4);
    for (const player of players) {
      const { results } = await env.games_db
        .prepare("SELECT Position, WasInP4, InP4 FROM PlayerTransfers WHERE PlayerId = ?")
        .bind(player.id)
        .run();
      expect(["QB", "RB", "WR"]).toContain(results[0].Position);
      expect(results[0].WasInP4 === 1 || results[0].InP4 === 1).toBe(true);
    }
  });

  it("sickos difficulty returns players of any position", async () => {
    const res = await SELF.fetch("http://fake-host/api/transfer-wizard/get-players?difficulty=sickos");
    expect(res.status).toBe(200);
    const { players } = await res.json();
    expect(players).toHaveLength(4);
  });
});

describe("POST /api/transfer-wizard/submit", () => {
  // The client parses res.question with JSON.parse before submitting, so the
  // POST body sends an array. checkAnswer does JSON.stringify(body.question)
  // which reconstructs the exact string stored in the Transfers column.

  it("returns the matching player PID for a correct answer", async () => {
    const res = await SELF.fetch("http://fake-host/api/transfer-wizard/submit", {
      method: "POST",
      body: JSON.stringify({ question: ["New Mexico", "Alabama"] }),
    });
    expect(res.status).toBe(200);
    const { pids } = await res.json();
    expect(pids).toContain(1);
  });

  it("returns multiple PIDs when several players share the same transfer route", async () => {
    const res = await SELF.fetch("http://fake-host/api/transfer-wizard/submit", {
      method: "POST",
      body: JSON.stringify({ question: ["Texas", "USC"] }),
    });
    expect(res.status).toBe(200);
    const { pids } = await res.json();
    expect(pids).toHaveLength(2);
    expect(pids).toContain(5);
    expect(pids).toContain(6);
  });

  it("returns an empty pids array when the question matches no player", async () => {
    const res = await SELF.fetch("http://fake-host/api/transfer-wizard/submit", {
      method: "POST",
      body: JSON.stringify({ question: ["Nowhere", "Nowhere"] }),
    });
    expect(res.status).toBe(200);
    const { pids } = await res.json();
    expect(pids).toHaveLength(0);
  });
});

describe("Routing", () => {
  it("unknown API path returns 404", async () => {
    const res = await SELF.fetch("http://fake-host/api/unknown-endpoint");
    expect(res.status).toBe(404);
  });
});
