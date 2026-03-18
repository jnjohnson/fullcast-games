import { describe, it, expect, vi } from "vitest";
import { addNewPlayer, updatePlayer } from "../server/transferWizard.js";

// Returns a chainable mock: db.prepare(...).bind(...).run()
function makeMockDb() {
  const run = vi.fn().mockResolvedValue({ results: [] });
  const stmt = { bind: vi.fn(() => ({ run })) };
  const db = { prepare: vi.fn(() => stmt) };
  return { db, stmt, run };
}

describe("updatePlayer", () => {
  it("returns false when destination is already the last entry in Transfers", () => {
    const { db } = makeMockDb();
    const player = { PlayerId: 1, Transfers: '["Texas","Alabama"]' };
    const result = updatePlayer(player, { destination: "Alabama" }, { games_db: db });
    expect(result).toBe(false);
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it("returns true and calls DB update when destination is new", () => {
    const { db } = makeMockDb();
    const player = { PlayerId: 1, Transfers: '["Texas","USC"]' };
    const result = updatePlayer(player, { destination: "Georgia" }, { games_db: db });
    expect(result).toBe(true);
    expect(db.prepare).toHaveBeenCalledOnce();
  });

  it("sets InP4 = true when destination is a P4 school", () => {
    const { db, stmt } = makeMockDb();
    const player = { PlayerId: 1, Transfers: '["New Mexico","UTSA"]' };
    updatePlayer(player, { destination: "Alabama" }, { games_db: db });
    expect(stmt.bind).toHaveBeenCalledWith(true, expect.any(String), 1);
  });

  it("sets InP4 = false when destination is a non-P4 school", () => {
    const { db, stmt } = makeMockDb();
    const player = { PlayerId: 1, Transfers: '["Texas","USC"]' };
    updatePlayer(player, { destination: "UTSA" }, { games_db: db });
    expect(stmt.bind).toHaveBeenCalledWith(false, expect.any(String), 1);
  });

  it("appends destination correctly to Transfers JSON", () => {
    const { db, stmt } = makeMockDb();
    const player = { PlayerId: 1, Transfers: '["Texas","USC"]' };
    updatePlayer(player, { destination: "Georgia" }, { games_db: db });
    expect(stmt.bind).toHaveBeenCalledWith(expect.anything(), '["Texas","USC","Georgia"]', 1);
  });
});

describe("addNewPlayer", () => {
  it("calls INSERT with WasInP4 = true for a P4 origin", () => {
    const { db, stmt } = makeMockDb();
    addNewPlayer(
      { firstName: "John", lastName: "Doe", position: "QB", origin: "Alabama", destination: "Georgia" },
      { games_db: db }
    );
    expect(stmt.bind).toHaveBeenCalledWith("John", "Doe", "QB", true, true, '["Alabama","Georgia"]');
  });

  it("calls INSERT with WasInP4 = false for a non-P4 origin", () => {
    const { db, stmt } = makeMockDb();
    addNewPlayer(
      { firstName: "John", lastName: "Doe", position: "QB", origin: "UTSA", destination: "Georgia" },
      { games_db: db }
    );
    expect(stmt.bind).toHaveBeenCalledWith("John", "Doe", "QB", false, true, '["UTSA","Georgia"]');
  });

  it("calls INSERT with InP4 = true for a P4 destination", () => {
    const { db, stmt } = makeMockDb();
    addNewPlayer(
      { firstName: "Jane", lastName: "Smith", position: "RB", origin: "UTSA", destination: "Alabama" },
      { games_db: db }
    );
    expect(stmt.bind).toHaveBeenCalledWith("Jane", "Smith", "RB", false, true, '["UTSA","Alabama"]');
  });

  it("calls INSERT with InP4 = false for a non-P4 destination", () => {
    const { db, stmt } = makeMockDb();
    addNewPlayer(
      { firstName: "Jane", lastName: "Smith", position: "WR", origin: "Alabama", destination: "UTSA" },
      { games_db: db }
    );
    expect(stmt.bind).toHaveBeenCalledWith("Jane", "Smith", "WR", true, false, '["Alabama","UTSA"]');
  });

  it('formats Transfers JSON as ["origin","destination"]', () => {
    const { db, stmt } = makeMockDb();
    addNewPlayer(
      { firstName: "Joe", lastName: "Bob", position: "TE", origin: "New Mexico", destination: "UTSA" },
      { games_db: db }
    );
    expect(stmt.bind).toHaveBeenCalledWith("Joe", "Bob", "TE", false, false, '["New Mexico","UTSA"]');
  });
});
