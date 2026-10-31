import { describe, expect, it } from "vitest";
import { calculateResearch, validateDraft } from "./engine";
import {
  DIMENSIONS,
  fromLegacy,
  newResearchDraft,
  labels,
  type FirstUnit,
  type Vector,
} from "./types";
import {
  computeScore,
  assertWeights,
  assertRatings,
  durationWeightedFirst,
} from "./math";
import { weightProfiles, genres } from "./catalog";
import { newAlbum } from "../types";

const all = (v: number) =>
  Object.fromEntries(DIMENSIONS.map((k) => [k, v])) as Vector;
const unit = (
  ticks: number,
  ms = 200_000,
  mode: "lyrics" | "expression" = "lyrics",
): FirstUnit => ({
  id: crypto.randomUUID(),
  trackId: "",
  title: "明确标注的虚构单位",
  durationMs: ms,
  mode,
  ratingTicks: ticks,
  evidence: "虚构技术测试，不代表真实听评",
});
describe("V0.35 integer engine and review boundaries", () => {
  it("checks 13,050 catalog scores against a BigInt HALF_UP oracle", () => {
    let cases = 0;
    for (const p of weightProfiles)
      for (let n = 0; n < 25; n++) {
        const ratings = Object.fromEntries(
          DIMENSIONS.map((k, i) => [
            k,
            1 + ((Math.floor(n / 10 ** (i % 3)) + i * 3) % 10),
          ]),
        ) as Vector;
        const result = computeScore(p.weightsTicks, ratings),
          numerator = DIMENSIONS.reduce((sum,k) => sum + BigInt(p.weightsTicks[k]) * BigInt(ratings[k]), 0n),
          cents = Number((numerator + 1n) / 2n);
        expect(result).toEqual({
          scoreCents: cents,
          exactNumerator: Number(numerator),
          display: `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`,
        });
        cases++;
      }
    expect(cases).toBe(13050);
  });
  it("rounds an exact .005 upward using integer HALF_UP", () => {
    const weights = {
      first: 1,
      composition: 139,
      performance: 0,
      sound: 0,
      vision: 30,
      context: 30,
    };
    expect(computeScore(weights, { ...all(8), first: 9 })).toEqual({
      scoreCents: 801,
      exactNumerator: 1601,
      display: "8.01",
    });
  });
  it("rejects decimal ticks, seventh dimensions, N/A, zero and missing ratings", () => {
    const w = weightProfiles[0].weightsTicks;
    for (const bad of [
      { ...w, first: w.first + 0.4, composition: w.composition - 0.4 },
      { ...w, vision: 29, context: 31 },
      { ...w, extra: 0 },
    ])
      expect(() => assertWeights(bad)).toThrow();
    for (const bad of [
      { ...all(8), first: 0 },
      { ...all(8), first: 10.5 },
      { ...all(8), first: "na" },
      { ...all(8), first: null },
      { ...all(8), lyrics: 8 },
    ])
      expect(() => assertRatings(bad as unknown as Vector)).toThrow();
  });
  it.each([4.2, 4.25, 4.3])(
    "blocks mixed first-slot midpoint boundary at %s stars",
    (stars) => {
      const upperMs = Math.round((stars - 4) * 2 * 1_000_000),
        lowerMs = 1_000_000 - upperMs;
      const r = durationWeightedFirst([
        unit(8, lowerMs),
        unit(9, upperMs, "expression"),
      ]);
      expect(r.needsManualMidpointReview).toBe(true);
      expect(r.candidateTicks).toBeNull();
      expect(r.advisoryOnly).toBe(true);
    },
  );
  it.each([4.1999995, 4.3000005])(
    "does not widen the exact midpoint interval at %s",
    (stars) => {
      const upperMs = Math.round((stars - 4) * 2 * 1_000_000);
      expect(
        durationWeightedFirst([
          unit(8, 1_000_000 - upperMs),
          unit(9, upperMs, "expression"),
        ]).needsManualMidpointReview,
      ).toBe(false);
    },
  );
  it("never assigns advisory results to the final first-slot star or the other five dimensions", () => {
    const d = newResearchDraft();
    Object.assign(d, {
      coreGenreId: "genre:post-punk",
      firstMode: "mixed",
      firstUnits: [unit(8), unit(9, 200_000, "expression")],
      firstVerdict: "独立人工裁定",
      ratings: all(7),
    });
    const before = structuredClone(d);
    expect(calculateResearch(d).score).toBeNull();
    expect(d).toEqual(before);
    d.midpointReviewed = true;
    expect(calculateResearch(d).score?.display).toBe("7.00");
    expect(d.ratings.first).toBe(7);
  });
  it("keeps all 43 index entries unscorable and all five definition entries explicitly research-only", () => {
    for (const g of genres.filter((g) =>
      ["index_only", "definition_review"].includes(g.classification),
    )) {
      const d = { ...newResearchDraft(), coreGenreId: g.id, ratings: all(8) };
      expect(calculateResearch(d).score).toBeNull();
      d.explicitResearchOverride = true;
      const result = calculateResearch(d);
      if (g.classification === "index_only") expect(result.score).toBeNull();
      else expect(result.score?.display).toBe("8.00");
      expect(result.publishable).toBe(false);
    }
  });
  it("requires six album ratings and never supplies a default Performance grade", () => {
    const d = {
      ...newResearchDraft(),
      coreGenreId: "genre:post-punk",
      ratings: { ...all(8), performance: null },
    };
    d.evidence.performance.status = "insufficient";
    expect(calculateResearch(d).score).toBeNull();
    expect(calculateResearch(d).warnings.join(" ")).toContain("表演证据不足");
    expect(d.ratings.performance).toBeNull();
  });
  it("starts empty and clears every legacy rating, N/A, correction and evidence when explicitly copying metadata", () => {
    const legacy = newAlbum();
    legacy.title = "技术用例";
    legacy.ratings.lyrics.value = "na";
    legacy.ratings.composition.value = 5;
    legacy.ratings.composition.evidence = "旧证据";
    legacy.sourceDelta = [-2, -2, 2, 2, 0, 0];
    const before = structuredClone(legacy),
      d = fromLegacy(legacy, "legacy-snapshot", "8.31");
    expect(d.id).not.toBe(legacy.id);
    expect(d.title).toBe(legacy.title);
    expect(d.parent?.snapshotId).toBe("legacy-snapshot");
    expect(
      DIMENSIONS.every(
        (k) => d.ratings[k] === null && d.evidence[k].support === "",
      ),
    ).toBe(true);
    expect(legacy).toEqual(before);
    expect("sourceDelta" in d).toBe(false);
    expect(
      fromLegacy(legacy, "legacy-17", "6.66", "V0.17-technical-legacy").parent
        ?.modelVersion,
    ).toBe("V0.17-technical-legacy");
  });
  it("uses only the exact six bilingual labels for semantic, wordless and mixed works", () => {
    expect(labels("lyrics").first).toEqual({ zh: "歌词", en: "Lyrics" });
    expect(labels("expression").first.en).toBe("Expression");
    expect(labels("mixed").first.en).toBe("Lyrics / Expression");
    expect(DIMENSIONS.map((k) => labels("mixed")[k].en)).toEqual([
      "Lyrics / Expression",
      "Composition",
      "Performance",
      "Sound",
      "Vision",
      "Context",
    ]);
  });
  it("limits auxiliary tags and rejects local attempts to set approved/published state", () => {
    const d = { ...newResearchDraft(), coreGenreId: "genre:post-punk" };
    expect(() =>
      validateDraft({
        ...d,
        auxiliaryGenreIds: ["genre:j-pop", "genre:folk-pop", "genre:twee-pop"],
      }),
    ).toThrow("最多两个");
    expect(() => validateDraft({ ...d, status: "approved" })).toThrow(
      "本地候选",
    );
    expect(() => validateDraft({ ...d, status: "published" })).toThrow(
      "本地候选",
    );
  });
  it("keeps the publication gate closed even after all local evidence is filled", () => {
    const d = {
      ...newResearchDraft(),
      coreGenreId: "genre:post-punk",
      ratings: all(8),
      fullAlbumListeningVerified: true,
      sourceEditionVerified: true,
      release: "虚构技术版次",
      reviewer: "技术测试者",
    };
    for (const k of DIMENSIONS)
      d.evidence[k] = {
        status: "supported",
        support: "正例",
        counterexample: "反例",
        rationale: "理由",
        adjacentGrade: "区别",
      };
    expect(calculateResearch(d).publishable).toBe(false);
    expect(calculateResearch(d).publicationBlockers.join(" ")).toContain(
      "research_candidate",
    );
  });
});
