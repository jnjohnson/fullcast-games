import { describe, it, expect } from "vitest";
import { buildTransferChain } from "../server/transferWizard.js";

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
      row("Auburn", "Oregon", 2022),
      row("Oregon", "LSU",    2024),
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

  it("case 2: returns a 1-stop chain when fromTeam == toTeam and is the only row", () => {
    const chain = buildTransferChain([row("Alabama", "Alabama", 2024)]);
    expect(chain).toEqual([{ team: "Alabama" }]);
  });

  it("case 3: shows N/A stop and re-inserts fromTeam when toTeam is null and another row follows", () => {
    const chain = buildTransferChain([
      row("UTSA", null,    2023),
      row("UTSA", "Texas", 2024),
    ]);
    expect(chain).toEqual([
      { team: "UTSA" },
      { season: 2023, team: "N/A" },
      { season: "N/A", team: "UTSA" },
      { season: 2024, team: "Texas" },
    ]);
  });

  it("case 4: produces a 2-stop chain with N/A destination when toTeam is null and is the only row", () => {
    const chain = buildTransferChain([row("Alabama", null, 2024)]);
    expect(chain).toEqual([{ team: "Alabama" }, { season: 2024, team: "N/A" }]);
  });

  it("case 5: inserts an N/A-seasoned intermediate stop when fromTeam[N] differs from toTeam[N-1]", () => {
    const chain = buildTransferChain([
      row("Clemson", "South Carolina", 2023),
      row("Florida", "Tennessee",      2024),
    ]);
    expect(chain).toEqual([
      { team: "Clemson" },
      { season: 2023, team: "South Carolina" },
      { season: "N/A", team: "Florida" },
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
