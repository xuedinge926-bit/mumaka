import source from "../../data/v038";
import { auditReferences, artistIdentity } from "../../lib/referenceAudit";
import { upgradeReferenceCatalog, REFERENCE_VERSION } from "../../lib/referenceReview";
import {
  CATEGORIES,
  NAMES,
  type Catalog,
  type Six,
  type Anchor,
} from "./types";

export function assertWeights(value: unknown): asserts value is Six<number> {
  if (
    !Array.isArray(value) ||
    value.length !== 6 ||
    value.some((n) => !Number.isSafeInteger(n) || n < 0 || n > 200) ||
    value.slice(0, 4).reduce((a, b) => a + b, 0) !== 140 ||
    value[4] !== 30 ||
    value[5] !== 30
  )
    throw new Error(
      "权重必须为整数半百分点；前四维70%，愿景、语境各15%，合计100%。",
    );
}
export function anchorIssues(anchor: Anchor, anchors: Anchor[]): string[] {
  const issues: string[] = [];
  if (!anchor.artist || anchor.unassigned) issues.push("待选格位");
  else {
    const set = anchors.filter(
      (a) =>
        a.region === anchor.region &&
        a.category === anchor.category &&
        artistIdentity(a) === artistIdentity(anchor) &&
        !a.unassigned,
    );
    if (set.filter((a) => a.dimension === anchor.dimension).length > 1)
      issues.push("同维七档艺人重复，待重选");
    if (set.length > 2)
      issues.push(`同表艺人出现${set.length}次，超过2次，待重选`);
    issues.push(...auditReferences(anchors).filter(i => i.id === anchor.id && i.severity === "error").map(i => i.message));
  }
  if (!anchor.approved) issues.push("未审定，不能作为正式标尺");
  return issues;
}
export function validateCatalog(value: unknown): Catalog {
  const c = value as Catalog;
  if (
    !c ||
    c.schemaVersion !== 1 ||
    !/^v0\.38/.test(c.sourceVersion) ||
    !c.weightVersion ||
    !/^[a-f0-9]{64}$/.test(c.sourceSha256) ||
    !Array.isArray(c.families) ||
    !Array.isArray(c.genres) ||
    c.families.length !== 34 ||
    c.genres.length !== 565 ||
    new Set(c.families.map((f) => f.id)).size !== 34 ||
    new Set(c.genres.map((g) => g.id)).size !== 565
  )
    throw new Error(
      "导入需要完整V0.38包：34一级、565唯一稳定ID、来源SHA-256。",
    );
  const familyIds = new Set(c.families.map((f) => f.id));
  for (const f of c.families)
    for (const category of CATEGORIES)
      assertWeights(f.profiles?.[category]?.weightsTicks);
  for (const g of c.genres) {
    if (
      !familyIds.has(g.familyId) ||
      !g.name ||
      !g.nameEn ||
      ![
        "independent_candidate",
        "general_entry",
        "index_only",
        "definition_review",
      ].includes(g.classification)
    )
      throw new Error("风格身份或分类无效");
    for (const category of CATEGORIES) {
      const p = g.profiles?.[category];
      if (
        !p ||
        typeof p.trialAllowed !== "boolean" ||
        !p.applicability ||
        !p.reviewStatus ||
        !p.source ||
        !p.rationale
      )
        throw new Error("缺少双模式适用性、来源或审核状态");
      if (
        (p.applicability.includes("不适用") ||
          p.applicability.includes("索引")) &&
        p.trialAllowed
      )
        throw new Error("不适用组合与索引不得开启试算");
      if (g.classification === "index_only") {
        if (p.weightsTicks !== null || p.trialAllowed)
          throw new Error("43个索引不能包含评分权重");
      } else assertWeights(p.weightsTicks);
      if (
        p.reviewStatus === "approved" &&
        (!p.approval?.reviewer.trim() ||
          !p.approval.evidence.trim() ||
          !Number.isFinite(Date.parse(p.approval.reviewedAt)))
      )
        throw new Error("批准权重需要明确的人工作者、日期与依据");
    }
  }
  if (
    c.genres.filter((g) => g.classification === "index_only").length !== 43 ||
    c.genres.filter((g) => g.classification === "definition_review").length !==
      5
  )
    throw new Error("必须保留43索引和5定义争议条目");
  if (
    c.genres.find((g) => g.id === "genre:chinese-style-pop")?.name !== "国风" ||
    c.genres.some((g) => g.name === "中国风")
  )
    throw new Error("国风名称必须保留；不能与古风合并");
  if (
    !Array.isArray(c.anchors) ||
    c.anchors.length !== 168 ||
    new Set(c.anchors.map((a) => a.id)).size !== 168
  )
    throw new Error("参考包必须保留168个格位");
  for (const region of ["china", "global"])
    for (const category of CATEGORIES)
      for (const dimension of NAMES[category]) {
        const cells = c.anchors.filter(
          (a) =>
            a.region === region &&
            a.category === category &&
            a.dimension === dimension,
        );
        if (
          cells.length !== 7 ||
          new Set(cells.map((a) => a.stars)).size !== 7 ||
          cells.some((a) => ![2, 2.5, 3, 3.5, 4, 4.5, 5].includes(a.stars))
        )
          throw new Error("参考只设六维×2—5星七档");
      }
  for (const a of c.anchors)
    if (a.approved && a.version === REFERENCE_VERSION && anchorIssues(a, c.anchors).length)
      throw new Error("不符合去重规则的参考不得标为审定");
  return structuredClone(c);
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export const bundledCatalog = freeze(validateCatalog(upgradeReferenceCatalog(validateCatalog(source))));
export const catalogCounts = {
  families: bundledCatalog.families.length,
  stableIds: bundledCatalog.genres.length,
  weightedCandidates: bundledCatalog.genres.filter(
    (g) => g.classification !== "index_only",
  ).length,
  indexOnly: 43,
  definitionReview: 5,
};
