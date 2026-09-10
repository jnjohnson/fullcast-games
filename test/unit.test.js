import { describe, it, expect } from "vitest";
import { hashValue, buildTransferChain } from "../server/transferWizard.js";

describe("hashValue", () => {
  it("returns a 64-character hex string", async () => {
    const hash = await hashValue({ team: "Alabama" });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces the same hash for identical inputs", async () => {
    const a = await hashValue([{ team: "Virginia" }, { season: 2025, team: "UNLV" }]);
    const b = await hashValue([{ team: "Virginia" }, { season: 2025, team: "UNLV" }]);
    expect(a).toBe(b);
  });

  it("produces different hashes for different inputs", async () => {
    const a = await hashValue([{ team: "Alabama" }]);
    const b = await hashValue([{ team: "Georgia" }]);
    expect(a).not.toBe(b);
  });

  it("is sensitive to key order differences in objects", async () => {
    const a = await hashValue({ season: 2025, team: "UNLV" });
    const b = await hashValue({ team: "UNLV", season: 2025 });
    // JSON.stringify preserves insertion order, so these differ
    expect(a).not.toBe(b);
  });
});

// ─── buildTransferChain ───────────────────────────────────────────────────────

function row(fromSchool, toSchool, season = 2024) {
  return {
    season,
    fromTeam: fromSchool ? { school: fromSchool } : null,
    toTeam:   toSchool   ? { school: toSchool }   : null,
  };
}

describe("buildTransferChain", () => {
  it("builds a 2-stop chain for a normal single transfer", () => {
    const chain = buildTransferChain([row("Auburn", "Oregon", 2023)]);
    expect(chain).toEqual([{ team: "Auburn" }, { season: 2023, team: "Oregon" }]);
  });

  it("builds a 3-stop chain for two consecutive transfers", () => {
    const chain = buildTransferChain([
      row("Auburn",  "Oregon", 2022),
      row("Oregon",  "LSU",    2024),
    ]);
    expect(chain).toEqual([
      { team: "Auburn" },
      { season: 2022, team: "Oregon" },
      { season: 2024, team: "LSU" },
    ]);
  });

  it("case 1: skips destination when fromTeam == toTeam (not the only row)", () => {
    const chain = buildTransferChain([
      row("Alabama", "Alabama", 2023),
      row("Alabama", "Georgia", 2024),
    ]);
    expect(chain).toEqual([{ team: "Alabama" }, { season: 2024, team: "Georgia" }]);
  });

  it("case 2: returns a length-1 array when fromTeam == toTeam and is the only row", () => {
    const chain = buildTransferChain([row("Alabama", "Alabama", 2024)]);
    expect(chain).toHaveLength(1);
    expect(chain[0]).toEqual({ team: "Alabama" });
  });

  it("case 3: skips a null-toTeam row when other rows exist", () => {
    const chain = buildTransferChain([
      row("UTSA",    null,      2023),
      row("UTSA",    "Texas",   2024),
    ]);
    expect(chain).toEqual([{ team: "UTSA" }, { season: 2024, team: "Texas" }]);
  });

  it("case 4: returns a length-1 array when toTeam is null and is the only row", () => {
    const chain = buildTransferChain([row("Alabama", null, 2024)]);
    expect(chain).toHaveLength(1);
    expect(chain[0]).toEqual({ team: "Alabama" });
  });

  it("case 5: inserts an intermediate stop when fromTeam[N] differs from toTeam[N-1]", () => {
    const chain = buildTransferChain([
      row("Clemson",        "South Carolina", 2023),
      row("Florida",        "Tennessee",      2024),
    ]);
    expect(chain).toEqual([
      { team: "Clemson" },
      { season: 2023, team: "South Carolina" },
      { season: 2024, team: "Florida" },
      { season: 2024, team: "Tennessee" },
    ]);
  });

  it("returns an empty array when fromTeam is null on the first row", () => {
    const chain = buildTransferChain([row(null, "Alabama", 2024)]);
    expect(chain).toHaveLength(0);
  });

  it("returns an empty array for an empty input", () => {
    expect(buildTransferChain([])).toEqual([]);
  });
});
