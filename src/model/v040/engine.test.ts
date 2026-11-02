import { describe, expect, it } from "vitest";
import {
  bundledCatalog,
  assertWeights,
  validateCatalog,
  anchorIssues,
} from "./catalog";
import { calculate, score, validateDraft, canSnapshot } from "./engine";
import { CATEGORIES, NAMES, newDraft, fromLegacy, six } from "./types";
import { newAlbum } from "../types";
import publicV035 from "../../data/v035/genres.v035.json";

export function ratedDraft() {
  const d = newDraft();
  d.title = "双体系技术测试";
  d.artist = "人工测试";
  for (const category of CATEGORIES) {
    d.modes[category].genreId = "genre:dance-pop";
    d.modes[category].ratingsTicks = six(() => 8);
    d.modes[category].applicabilityNote = "测试所需的适用依据";
  }
  return d;
}
describe("V0.38.1 actual source catalog", () => {
  it("retains all public stable IDs, 34 families, 522 numeric candidates, 43 indexes and 5 disputes", () => {
    expect(bundledCatalog.genres.map((g) => g.id).sort()).toEqual(
      publicV035.map((g) => g.id).sort(),
    );
    expect(bundledCatalog.families).toHaveLength(34);
    expect(
      bundledCatalog.genres.filter((g) => g.classification !== "index_only"),
    ).toHaveLength(522);
    expect(
      bundledCatalog.genres.filter(
        (g) => g.classification === "definition_review",
      ),
    ).toHaveLength(5);
    expect(bundledCatalog.sourceSha256).toBe(
      "a71174c951a73f95f1f8a563308e2741b51c0ce68f7a18a3da18aca4ef5337f2",
    );
  });
  it("loads genuinely separate source vectors, not renamed legacy numbers", () => {
    const p = bundledCatalog.genres.find(
      (g) => g.id === "genre:dance-pop",
    )!.profiles;
    expect(p.song.weightsTicks).toEqual([38, 46, 32, 24, 30, 30]);
    expect(p.instrumental.weightsTicks).toEqual([36, 54, 32, 18, 30, 30]);
    expect(p.song.sourceSheet).toBe("02歌曲565");
    expect(p.instrumental.sourceSheet).toBe("03乐曲565");
    for (const g of bundledCatalog.genres)
      for (const category of CATEGORIES) {
        const p = g.profiles[category];
        if (g.classification === "index_only") {
          expect(p.weightsTicks).toBeNull();
          expect(p.trialAllowed).toBe(false);
        } else assertWeights(p.weightsTicks);
        expect(p.reviewStatus).not.toBe("approved");
      }
    for (const f of bundledCatalog.families)
      for (const c of CATEGORIES) assertWeights(f.profiles[c].weightsTicks);
  });
  it("blocks 19 non-applicable combinations plus all definition-review combinations", () => {
    const combinations = bundledCatalog.genres
      .flatMap((g) =>
        CATEGORIES.map((category) => ({
          g,
          category,
          p: g.profiles[category],
        })),
      )
      .filter((x) => x.p.weightsTicks && !x.p.trialAllowed);
    expect(combinations).toHaveLength(28);
    expect(
      combinations.filter((x) => x.p.applicability === "不适用"),
    ).toHaveLength(19);
    for (const { g, category } of combinations) {
      const d = ratedDraft();
      d.category = category;
      d.modes[category].genreId = g.id;
      expect(calculate(d).total).toBeNull();
    }
  });
  it("does not turn index or definition records into scored styles", () => {
    for (const g of bundledCatalog.genres.filter((g) =>
      ["index_only", "definition_review"].includes(g.classification),
    )) {
      const d = ratedDraft();
      d.modes.song.genreId = g.id;
      expect(calculate(d).total).toBeNull();
    }
    expect(
      bundledCatalog.genres.find((g) => g.id === "genre:chinese-style-pop")!
        .name,
    ).toBe("国风");
    expect(
      bundledCatalog.genres.find((g) => g.id === "genre:gufeng-pop")!.name,
    ).toBe("古风流行");
  });
  it("requires complete source-backed imports and manual approval evidence", () => {
    const c = structuredClone(bundledCatalog);
    c.genres[0].profiles.song.reviewStatus = "approved";
    expect(() => validateCatalog(c)).toThrow(/批准权重/);
    c.genres[0].profiles.song.reviewStatus = "研究候选";
    c.genres.pop();
    expect(() => validateCatalog(c)).toThrow();
  });
});
describe("integer half-point and half-star arithmetic", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])(
    "all rating ticks %i yields the exact expected ten-point score",
    (tick) => {
      const d = ratedDraft();
      d.modes.song.ratingsTicks = six(() => tick);
      expect(calculate(d).total).toBe(`${tick}.00`);
    },
  );
  it("rounds ties upward and keeps exact numerator", () => {
    expect(score(1571)).toEqual({ scoreCents: 786, total: "7.86" });
    expect(score(2000).total).toBe("10.00");
    expect(score(100).total).toBe("0.50");
    expect(score(157099, 20000).total).toBe("7.85");
  });
  it("rejects invalid weight precision, totals, fixed shares, negative and noninteger ticks", () => {
    for (const w of [
      [38.2, 45.8, 32, 24, 30, 30],
      [38, 46, 32, 23, 30, 30],
      [38, 46, 32, 24, 29, 31],
      [-1, 85, 32, 24, 30, 30],
      [201, -117, 32, 24, 30, 30],
    ])
      expect(() => assertWeights(w)).toThrow();
    const d = ratedDraft();
    for (const tick of [0, 11, 7.1, NaN]) {
      d.modes.song.ratingsTicks[0] = tick;
      expect(() => validateDraft(d)).toThrow();
      expect(calculate(d).total).toBeNull();
    }
  });
  it("does not fill unknown performance with an arbitrary low score", () => {
    const d = ratedDraft();
    d.modes.song.performanceUncertain = true;
    expect(calculate(d).total).toBeNull();
    expect(d.modes.song.ratingsTicks[2]).toBe(8);
  });
  it("keeps independent category drafts, dimensions and metadata-only legacy copies", () => {
    const d = ratedDraft();
    d.modes.instrumental.ratingsTicks[0] = 5;
    d.category = "instrumental";
    expect(calculate(d).weights.instrumental).toEqual([36, 54, 32, 18, 30, 30]);
    d.category = "song";
    expect(d.modes.song.ratingsTicks[0]).toBe(8);
    const old = newAlbum();
    old.ratings.lyrics.value = 5;
    old.ratings.sound.value = 4;
    const copied = fromLegacy(old);
    expect(copied.modes.song.ratingsTicks).toEqual(six(() => null));
    expect(copied.modes.instrumental.ratingsTicks).toEqual(six(() => null));
    for (const names of Object.values(NAMES))
      for (const name of names) expect([...name]).toHaveLength(2);
  });
  it("does not publish research weights even after filling listening and human evidence", () => {
    const d = ratedDraft();
    d.fullAlbumListening = true;
    d.reviewer = "人工评审";
    d.modes.song.evidence = six(() => "整碟支持与反例");
    expect(calculate(d).publishable).toBe(false);
  });
  it("requires a justification for conditional applicability before saving", () => {
    const d = ratedDraft();
    d.category = "instrumental";
    d.modes.instrumental.applicabilityNote = "";
    expect(calculate(d).total).toBe("8.00");
    expect(canSnapshot(d, calculate(d))).toBe(false);
  });
});
describe("mixed albums use artistic contribution, with vision/context exactly once", () => {
  it("requires an explicit human review and never uses track count", () => {
    const d = ratedDraft();
    d.mixed.enabled = true;
    d.mixed.visionTicks = 8;
    d.mixed.contextTicks = 8;
    expect(calculate(d).total).toBeNull();
    Object.assign(d.mixed, {
      reviewed: true,
      reviewer: "比重复核人",
      rationale: "两类作品的艺术贡献",
      songShareTicks: 120,
    });
    d.modes.instrumental.ratingsTicks = six(() => 6);
    expect(calculate(d).total).toBe("7.44");
    d.tracks = Array.from({ length: 17 }, (_, i) => ({
      id: String(i),
      title: "曲目",
      duration: 1,
    }));
    expect(calculate(d).total).toBe("7.44");
    d.modes.song.ratingsTicks[4] = 1;
    d.modes.instrumental.ratingsTicks[4] = 10;
    expect(calculate(d).total).toBe("7.44");
    d.mixed.songShareTicks = 121;
    expect(calculate(d).total).toBe("7.45");
  });
});
describe("168 reference positions retain research limits", () => {
  it("uses the manually revised full China table with the single permitted OYS repeat", () => {
    expect(bundledCatalog.anchors).toHaveLength(168);
    const cn = bundledCatalog.anchors.filter(
      (a) => a.region === "china" && a.category === "song",
    );
    expect(cn).toHaveLength(42);
    expect(cn.filter((a) => a.unassigned)).toHaveLength(0);
    expect(
      new Set(cn.filter((a) => !a.unassigned).map((a) => a.artist)).size,
    ).toBe(41);
    expect(
      cn.find((a) => a.dimension === "歌词" && a.stars === 4.5)!.album,
    ).toBe("万能青年旅店");
    expect(bundledCatalog.anchors.every((a) => !a.approved)).toBe(true);
    expect(bundledCatalog.anchors.some((a) => a.stars < 2)).toBe(false);
  });
  it("keeps all positions unreviewed while the revised tables meet the new repetition rules", () => {
    const issues = bundledCatalog.anchors.flatMap((a) =>
      anchorIssues(a, bundledCatalog.anchors),
    );
    expect(issues.every(i => i.includes("未审定"))).toBe(true);
    const invalid = structuredClone(bundledCatalog.anchors);
    invalid[1].artist = invalid[0].artist;
    invalid[1].primaryArtistId = invalid[0].primaryArtistId;
    expect(anchorIssues(invalid[0], invalid).some(i=>i.includes("同维七档"))).toBe(true);
  });
});
