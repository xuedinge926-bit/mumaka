import {
  DIMENSIONS,
  MODEL_VERSION,
  WEIGHT_VERSION,
  labels,
  type ResearchDraft,
  type Vector,
} from "./types";
import { familyById, genreById } from "./catalog";
import {
  assertRatings,
  computeScore,
  effectiveWeights,
  durationWeightedFirst,
} from "./math";

const text = (x: unknown): x is string => typeof x === "string";
const date = (x: unknown) => text(x) && Number.isFinite(Date.parse(x));
export function validateDraft(value: unknown): asserts value is ResearchDraft {
  if (!value || typeof value !== "object") throw new Error("研究草稿无效");
  const d = value as ResearchDraft;
  if (d.modelVersion !== MODEL_VERSION || d.weightVersion !== WEIGHT_VERSION)
    throw new Error("模型／权重版本不匹配");
  if (
    ![
      "id",
      "title",
      "artist",
      "year",
      "release",
      "cover",
      "coreGenreId",
      "reviewer",
      "summary",
      "firstVerdict",
    ].every((k) => text(d[k as keyof ResearchDraft])) ||
    !d.id ||
    !date(d.createdAt) ||
    !date(d.updatedAt) ||
    !Number.isInteger(d.revision) ||
    d.revision < 1
  )
    throw new Error("研究草稿缺少有效的资料、日期或ID");
  labels(d.firstMode);
  if (
    !["draft", "research_only", "in_review"].includes(d.status) ||
    !["专辑", "EP"].includes(d.kind)
  )
    throw new Error("本地候选目录只允许草稿、研究试评或待审核");
  if (
    !["cardRatio", "cardTheme"].every((k) =>
      text(d[k as keyof ResearchDraft]),
    ) ||
    !["4:5", "3:4", "1:1"].includes(d.cardRatio) ||
    !["paper", "ink"].includes(d.cardTheme)
  )
    throw new Error("评分卡设置无效");
  if (
    ![
      "explicitResearchOverride",
      "midpointReviewed",
      "fullAlbumListeningVerified",
      "sourceEditionVerified",
    ].every((k) => typeof d[k as keyof ResearchDraft] === "boolean")
  )
    throw new Error("复核状态无效");
  if (
    !Array.isArray(d.auxiliaryGenreIds) ||
    d.auxiliaryGenreIds.length > 2 ||
    new Set(d.auxiliaryGenreIds).size !== d.auxiliaryGenreIds.length ||
    d.auxiliaryGenreIds.some((id) => !genreById.has(id) || id === d.coreGenreId)
  )
    throw new Error("最多两个不重复的辅助风格标签，且不能重复主风格");
  if (d.coreGenreId && !genreById.has(d.coreGenreId))
    throw new Error("主风格ID不存在");
  if (
    d.cover.length > 12 * 1024 * 1024 ||
    (d.cover &&
      !/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(
        d.cover,
      ))
  )
    throw new Error("封面须为嵌入的本地图片");
  if (
    !d.ratings ||
    Object.keys(d.ratings).length !== 6 ||
    DIMENSIONS.some(
      (k) =>
        !Object.hasOwn(d.ratings, k) ||
        (d.ratings[k] !== null &&
          (!Number.isInteger(d.ratings[k]) ||
            d.ratings[k]! < 1 ||
            d.ratings[k]! > 10)),
    )
  )
    throw new Error("评分只能为整数半星tick或未评分；新模型不接受N/A");
  for (const k of DIMENSIONS) {
    const e = d.evidence?.[k];
    if (
      !e ||
      !["support", "counterexample", "rationale", "adjacentGrade"].every(
        (key) => text(e[key as keyof typeof e]),
      ) ||
      !["unreviewed", "supported", "insufficient"].includes(e.status)
    )
      throw new Error(`缺少${k}的证据字段`);
  }
  if (
    !Array.isArray(d.tracks) ||
    d.tracks.some(
      (t) =>
        !t.id ||
        !text(t.title) ||
        !Number.isFinite(t.duration) ||
        t.duration < 0,
    ) ||
    new Set(d.tracks.map((t) => t.id)).size !== d.tracks.length
  )
    throw new Error("曲目资料无效");
  if (
    !Array.isArray(d.firstUnits) ||
    d.firstUnits.some(
      (u) =>
        !u.id ||
        !text(u.trackId) ||
        !text(u.title) ||
        !text(u.evidence) ||
        !["lyrics", "expression"].includes(u.mode) ||
        !Number.isSafeInteger(u.durationMs) ||
        u.durationMs < 0 ||
        u.durationMs > 86_400_000 ||
        (u.ratingTicks !== null &&
          (!Number.isInteger(u.ratingTicks) ||
            u.ratingTicks < 1 ||
            u.ratingTicks > 10)),
    ) ||
    new Set(d.firstUnits.map((u) => u.id)).size !== d.firstUnits.length
  )
    throw new Error("首维曲目／乐段数据无效");
  if (
    d.parent &&
    (!text(d.parent.modelVersion) ||
      !text(d.parent.albumId) ||
      (d.parent.snapshotId !== undefined && !text(d.parent.snapshotId)))
  )
    throw new Error("派生历史引用无效");
}
export function calculateResearch(draft: ResearchDraft) {
  const errors: string[] = [],
    warnings: string[] = [];
  let weights: Vector | null = null;
  let score: ReturnType<typeof computeScore> | null = null;
  let mixed: ReturnType<typeof durationWeightedFirst> | null = null;
  try {
    validateDraft(draft);
    const genre = genreById.get(draft.coreGenreId);
    if (!genre) throw new Error("请选择一个主风格");
    if (
      genre.classification === "definition_review" &&
      !draft.explicitResearchOverride
    )
      throw new Error("该风格定义待审，须显式启用研究试算");
    weights = effectiveWeights(familyById.get(genre.family_id)!, genre);
    if (draft.firstMode === "mixed") {
      mixed = durationWeightedFirst(draft.firstUnits);
      if (new Set(draft.firstUnits.map((u) => u.mode)).size < 2)
        throw new Error("混合专辑须记录歌词与表意两类评价单位");
      if (draft.firstUnits.some((u) => !u.evidence.trim() || !u.title.trim()))
        throw new Error("请填写每个评价单位的名称与语义判断证据");
      if (!draft.firstVerdict.trim())
        throw new Error("首维时长结果仅作参考，请记录整碟人工裁定理由");
      if (mixed.needsManualMidpointReview && !draft.midpointReviewed)
        throw new Error("首维位于中界±0.05星，须人工复听复核");
    }
    if (DIMENSIONS.some((k) => draft.ratings[k] === null))
      throw new Error("六维尚未全部评分");
    assertRatings(draft.ratings as Vector);
    score = computeScore(weights, draft.ratings as Vector);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  if (draft.evidence?.performance?.status === "insufficient")
    warnings.push("表演证据不足：不能凭编程执行、乐器有无或默认星级替代听评");
  warnings.push("V0.34研究候选权重，尚未取得音乐学审定；分数仅供内部试评");
  return {
    weights,
    score,
    mixed,
    complete: score !== null && errors.length === 0,
    errors,
    warnings,
    publishable: false as const,
    status: "research_only" as const,
    publicationBlockers: publicationBlockers(draft),
  };
}
/** No local action can approve the frozen catalog or publish a research result. */
export function publicationBlockers(draft: ResearchDraft): string[] {
  const blockers = [
    "该权重版本仍为 research_candidate，须独立人工审定具体风格及版本",
  ];
  const genre = genreById.get(draft.coreGenreId);
  if (!genre || genre.classification === "index_only")
    blockers.push("须选择可计分主风格");
  if (genre?.classification === "definition_review")
    blockers.push("风格定义尚待裁定，研究覆盖许可不等于正式批准");
  if (!draft.fullAlbumListeningVerified) blockers.push("尚未确认完整复听");
  if (!draft.sourceEditionVerified || !draft.release.trim())
    blockers.push("尚未核对专辑发行版次及来源");
  if (!draft.reviewer.trim()) blockers.push("尚未记录评价人");
  for (const k of DIMENSIONS) {
    const e = draft.evidence?.[k];
    if (
      !e ||
      e.status !== "supported" ||
      !e.support.trim() ||
      !e.counterexample.trim() ||
      !e.rationale.trim() ||
      !e.adjacentGrade.trim()
    )
      blockers.push(
        `${labels(draft.firstMode)[k].zh}证据、反例及相邻档位说明待审核`,
      );
  }
  blockers.push("尚无独立评价批准及受控发布流程；本地RC1不提供正式发布操作");
  return blockers;
}
