import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import legacyGenres from "../../data/genres.json";
import manifest from "../../data/v035/MANIFEST.json";
import {
  families,
  genres,
  familyById,
  genreById,
  weightProfiles,
  validateCatalog,
  catalogCounts,
  percentagesToTicks,
  searchGenres,
} from "./catalog";
import { effectiveWeights, computeScore } from "./math";
import { DIMENSIONS, type Vector } from "./types";

describe("V0.35 raw catalog and source integrity", () => {
  it("verifies actual JSON counts, all 181 special records and four cleared residuals", () => {
    expect(catalogCounts).toEqual({
      families: 34,
      stableIds: 565,
      weightedCandidates: 522,
      indexOnly: 43,
      definitionReview: 5,
      generalEntries: 15,
      specializedRecords: 181,
      specializedWeighted: 177,
      clearedIndexResiduals: 4,
      approvedWeightProfiles: 0,
    });
    expect(new Set(genres.map((g) => g.id)).size).toBe(565);
    for (const old of legacyGenres)
      expect(genreById.has(old.id), old.id).toBe(true);
  });
  it("checks all family/delta snapshots and never materializes an index profile", () => {
    for (const g of genres) {
      if (g.classification === "index_only") {
        expect(g.effective_weight_ticks).toBeNull();
        expect(g.delta_ticks).toBeNull();
        expect(() => effectiveWeights(familyById.get(g.family_id)!, g)).toThrow(
          "索引",
        );
        expect(weightProfiles.some((p) => p.genreId === g.id)).toBe(false);
      } else
        expect(effectiveWeights(familyById.get(g.family_id)!, g)).toEqual(
          g.effective_weight_ticks,
        );
    }
    expect(weightProfiles).toHaveLength(522);
    expect(
      weightProfiles.every((p) => p.reviewStatus === "research_candidate"),
    ).toBe(true);
  });
  it("preserves 8.00 / 7.00 for every one of the 522 numeric profiles", () => {
    for (const p of weightProfiles)
      for (const tick of [7, 8])
        expect(
          computeScore(
            p.weightsTicks,
            Object.fromEntries(DIMENSIONS.map((k) => [k, tick])) as Vector,
          ).display,
        ).toBe(tick === 8 ? "8.00" : "7.00");
  });
  it("rejects hidden index values, approval changes, duplicate IDs and changed inheritance", () => {
    for (const alter of [
      (g: typeof genres) => {
        g[0].review_status = "approved";
      },
      (g: typeof genres) => {
        g[1].id = g[0].id;
      },
      (g: typeof genres) => {
        g.find(
          (x) => x.classification === "index_only",
        )!.effective_weight_ticks = { ...g[0].effective_weight_ticks! };
      },
      (g: typeof genres) => {
        g[0].effective_weight_ticks!.first += 1;
      },
    ]) {
      const altered = structuredClone(genres);
      alter(altered);
      expect(() =>
        validateCatalog(structuredClone(families), altered),
      ).toThrow();
    }
  });
  it("keeps Guofeng stable, searchable by archival alias, and separate from 古风", () => {
    expect(genreById.get("genre:chinese-style-pop")).toMatchObject({
      name_zh: "国风",
      name_en: "Guofeng",
      classification: "definition_review",
    });
    expect(searchGenres("genre:chinese-style-pop")).toHaveLength(1);
    const gufeng = genres.find((g) => g.id === "genre:gufeng-pop");
    expect(gufeng?.name_zh).toBe("古风流行");
    expect(gufeng!.id).not.toBe("genre:chinese-style-pop");
    expect(genres.some((g) => g.name_zh === "中国风")).toBe(false);
  });
  it.each([
    ["genre:bluegrass", [20, 22, 23, 5]],
    ["genre:progressive-bluegrass", [18, 26, 21, 5]],
    ["genre:opera", [18, 25, 23, 4]],
    ["genre:post-punk", [20, 19, 20, 11]],
    ["genre:dance-punk", [17, 18, 23, 12]],
    ["genre:drum-and-bass", [12, 23, 9, 26]],
    ["genre:jungle", [14, 22, 10, 24]],
    ["genre:progressive-rock", [16, 28, 18, 8]],
    ["genre:death-metal", [12, 27, 24, 7]],
    ["genre:twee-pop", [20, 25, 13, 12]],
  ])("checks V0.34 numerical regression %s", (id, values) => {
    const w = genreById.get(id as string)!.effective_weight_ticks!;
    expect(DIMENSIONS.slice(0, 4).map((k) => w[k] / 2)).toEqual(values);
  });
  it("allows intentional equal weights and retains Folk Pop / Twee Pop difference", () => {
    expect(genreById.get("genre:minimalism")!.effective_weight_ticks).toEqual(
      genreById.get("genre:post-minimalism")!.effective_weight_ticks,
    );
    expect(genreById.get("genre:folk-pop")!.effective_weight_ticks).not.toEqual(
      genreById.get("genre:twee-pop")!.effective_weight_ticks,
    );
  });
  it("accepts half percentage steps and rejects arbitrary decimals", () => {
    expect(
      percentagesToTicks({
        first: 20.5,
        composition: 23.5,
        performance: 13,
        sound: 13,
        vision: 15,
        context: 15,
      }).first,
    ).toBe(41);
    for (const n of [13.2, 13.7, 14.25])
      expect(() =>
        percentagesToTicks({
          first: n,
          composition: 44 - n,
          performance: 13,
          sound: 13,
          vision: 15,
          context: 15,
        }),
      ).toThrow();
  });
  it("verifies the public runtime JSON against frozen source hashes", async () => {
    for (const name of [
      "families.v035.json",
      "genres.v035.json",
      "MODEL_POLICY_V035.json",
    ]) {
      const bytes = await readFile(`src/data/v035/${name}`);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        manifest.files.find((f) => f.path === `data/${name}`)!.sha256,
      );
    }
  }, 120_000);
});
