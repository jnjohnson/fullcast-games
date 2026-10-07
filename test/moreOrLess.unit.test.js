import { describe, it, expect } from "vitest";
import { winPct, sumStatRows, isCorrect, formatValue } from "../server/moreOrLess.js";

// ─── winPct ───────────────────────────────────────────────────────────────────

describe("winPct", () => {
  it("divides wins by games played", () => {
    expect(winPct({ wins: 3, losses: 1, ties: 0 })).toBe(0.75);
  });

  it("counts a tie as half a win", () => {
    expect(winPct({ wins: 1, losses: 1, ties: 2 })).toBe(0.5);
  });

  it("returns 0 when no games were played", () => {
    expect(winPct({ wins: 0, losses: 0, ties: 0 })).toBe(0);
  });
});

// ─── sumStatRows ──────────────────────────────────────────────────────────────

describe("sumStatRows", () => {
  it("adds numeric per-game stats", () => {
    expect(sumStatRows([{ stat: "100" }, { stat: "48" }], "YDS")).toBe(148);
  });

  it("counts completions from C/ATT rows", () => {
    expect(sumStatRows([{ stat: "20/28" }, { stat: "31/43" }], "C/ATT")).toBe(51);
  });

  it("treats non-numeric values as 0", () => {
    expect(sumStatRows([{ stat: "--" }, { stat: "7" }], "TD")).toBe(7);
  });

  it("returns 0 for no rows", () => {
    expect(sumStatRows([], "YDS")).toBe(0);
  });
});

// ─── isCorrect ────────────────────────────────────────────────────────────────

describe("isCorrect", () => {
  it("is correct when B is more and the guess is more", () => {
    expect(isCorrect(10, 20, "more")).toBe(true);
    expect(isCorrect(10, 20, "less")).toBe(false);
  });

  it("is correct when B is less and the guess is less", () => {
    expect(isCorrect(20, 10, "less")).toBe(true);
    expect(isCorrect(20, 10, "more")).toBe(false);
  });

  it("accepts either guess on a tie", () => {
    expect(isCorrect(15, 15, "more")).toBe(true);
    expect(isCorrect(15, 15, "less")).toBe(true);
  });
});

// ─── formatValue ──────────────────────────────────────────────────────────────

describe("formatValue", () => {
  it("formats win % with the W-L record", () => {
    expect(formatValue("winPct", 187 / 240, { wins: 187, losses: 53, ties: 0 })).toBe(".779 (187-53)");
  });

  it("appends ties when there are any", () => {
    expect(formatValue("winPct", 0.5, { wins: 5, losses: 5, ties: 1 })).toBe(".500 (5-5-1)");
  });

  it("shows a perfect record as 1.000", () => {
    expect(formatValue("winPct", 1, { wins: 12, losses: 0, ties: 0 })).toBe("1.000 (12-0)");
  });

  it("adds thousands separators to other stats", () => {
    expect(formatValue("passYards", 8356)).toBe("8,356");
  });
});
