import familyData from "../../data/v035/families.v035.json";
import genreData from "../../data/v035/genres.v035.json";
import manifest from "../../data/v035/MANIFEST.json";
import {
  DIMENSIONS,
  WEIGHT_VERSION,
  type Family,
  type Genre,
  type WeightProfile,
} from "./types";
import { assertWeights, effectiveWeights } from "./math";

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export const families = freeze(familyData as unknown as Family[]);
export const genres = freeze(genreData as unknown as Genre[]);
export const familyById = new Map(families.map((f) => [f.id, f]));
export const genreById = new Map(genres.map((g) => [g.id, g]));
export const sourceFiles: Record<string, string> = Object.fromEntries(
  manifest.files.map((f) => [f.path, f.sha256]),
);
export const profileId = (id: string) => `${WEIGHT_VERSION}:${id}`;
export function validateCatalog(fs: Family[] = families, gs: Genre[] = genres) {
  if (
    !Array.isArray(fs) ||
    !Array.isArray(gs) ||
    fs.length !== 34 ||
    gs.length !== 565 ||
    new Set(fs.map((f) => f.id)).size !== 34 ||
    new Set(gs.map((g) => g.id)).size !== 565
  )
    throw new Error("目录必须保留34个一级和565个唯一稳定ID");
  const byFamily = new Map(fs.map((f) => [f.id, f]));
  for (const f of fs) {
    assertWeights(f.weights_ticks);
    if (
      f.review_status !== "research_candidate" ||
      !f.rationale ||
      !f.evidence_grade
    )
      throw new Error("一级权重必须保留研究候选状态及依据");
  }
  for (const g of gs) {
    if (
      !byFamily.has(g.family_id) ||
      ![
        "independent_candidate",
        "general_entry",
        "index_only",
        "definition_review",
      ].includes(g.classification)
    )
      throw new Error(`无效风格分类：${g.id}`);
    if (g.review_status !== "pending_editorial_and_listening_validation")
      throw new Error("原始风格审核状态不能自动批准");
    if (g.classification === "index_only") {
      if (
        g.weight_mode !== "none" ||
        g.delta_ticks !== null ||
        g.effective_weight_ticks !== null ||
        g.eligibility !== "index_only"
      )
        throw new Error(`索引残留数值：${g.id}`);
    } else {
      const expected =
        g.classification === "definition_review"
          ? "blocked_pending_classification"
          : "internal_trial_only";
      if (g.eligibility !== expected) throw new Error("分类与使用权限不一致");
      effectiveWeights(byFamily.get(g.family_id)!, g);
    }
  }
  const counts = {
    families: fs.length,
    stableIds: gs.length,
    weightedCandidates: gs.filter((g) => g.effective_weight_ticks !== null)
      .length,
    indexOnly: gs.filter((g) => g.classification === "index_only").length,
    definitionReview: gs.filter((g) => g.classification === "definition_review")
      .length,
    generalEntries: gs.filter((g) => g.classification === "general_entry")
      .length,
    specializedRecords: gs.filter((g) =>
      ["逐风格人工修订", "V0.34专项复核（候选）", "仅保留索引"].includes(
        g.historical.v034_review_method,
      ),
    ).length,
    specializedWeighted: gs.filter((g) =>
      ["逐风格人工修订", "V0.34专项复核（候选）"].includes(
        g.historical.v034_review_method,
      ),
    ).length,
    clearedIndexResiduals: gs.filter(
      (g) =>
        g.historical.v034_review_method === "仅保留索引" &&
        g.classification === "index_only" &&
        g.effective_weight_ticks === null &&
        g.delta_ticks === null,
    ).length,
    approvedWeightProfiles: gs.filter(
      (g) =>
        g.effective_weight_ticks !== null && g.review_status === "approved",
    ).length,
  };
  if (
    counts.weightedCandidates !== 522 ||
    counts.indexOnly !== 43 ||
    counts.definitionReview !== 5 ||
    counts.generalEntries !== 15 ||
    counts.specializedRecords !== 181 ||
    counts.specializedWeighted !== 177 ||
    counts.clearedIndexResiduals !== 4
  )
    throw new Error("原始JSON计数与RC1验收约束不符");
  const guofeng = gs.find((g) => g.id === "genre:chinese-style-pop");
  if (
    guofeng?.name_zh !== "国风" ||
    guofeng.name_en !== "Guofeng" ||
    guofeng.classification !== "definition_review" ||
    gs.some((g) => g.name_zh === "中国风")
  )
    throw new Error("国风命名或分类不正确");
  return counts;
}
export const catalogCounts = freeze(validateCatalog());
export const weightProfiles: WeightProfile[] = freeze(
  genres
    .filter((g) => g.classification !== "index_only")
    .map((g) => ({
      id: profileId(g.id),
      genreId: g.id,
      weightVersion: WEIGHT_VERSION,
      reviewStatus: "research_candidate" as const,
      weightsTicks: effectiveWeights(familyById.get(g.family_id)!, g),
    })),
);
export function searchGenres(query: string, familyId = "") {
  const q = query.trim().toLocaleLowerCase();
  return genres.filter(
    (g) =>
      (!familyId || g.family_id === familyId) &&
      (!q ||
        `${g.id} ${g.name_zh} ${g.name_en} ${g.historical.old_zh_alias ?? ""}`
          .toLocaleLowerCase()
          .includes(q)),
  );
}
/** Decimal percentage input is converted only if exactly on a half-point step. */
export function percentagesToTicks(
  values: Record<(typeof DIMENSIONS)[number], number>,
) {
  const result = Object.fromEntries(
    DIMENSIONS.map((k) => [k, values[k] * 2]),
  ) as Family["weights_ticks"];
  assertWeights(result);
  return result;
}
