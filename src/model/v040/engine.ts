import { assertWeights, bundledCatalog } from "./catalog";
import {
  CATEGORIES,
  MODEL_VERSION,
  DEFINITIONS_VERSION,
  type Draft,
  type Category,
  type Six,
  type Calculation,
  type FrozenCatalog,
} from "./types";

export function assertRating(tick: unknown): asserts tick is number | null {
  if (
    tick !== null &&
    (!Number.isSafeInteger(tick) ||
      (tick as number) < 1 ||
      (tick as number) > 10)
  )
    throw new Error("星级必须为0.5—5之间的半星（整数ticks 1—10）。");
}
export function score(numerator: number, denominator = 200) {
  if (
    !Number.isSafeInteger(numerator) ||
    numerator < 0 ||
    !Number.isSafeInteger(denominator) ||
    denominator <= 0
  )
    throw new Error("无效的精确评分分数");
  const cents = Number(
    (BigInt(numerator) * 200n + BigInt(denominator)) /
      (2n * BigInt(denominator)),
  );
  return {
    scoreCents: cents,
    total: `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`,
  };
}
export function validateDraft(value: unknown): asserts value is Draft {
  const d = value as Draft;
  if (
    !d ||
    d.schemaVersion !== 2 ||
    d.modelVersion !== MODEL_VERSION ||
    d.dimensionDefinitionsVersion !== DEFINITIONS_VERSION ||
    !d.id ||
    !CATEGORIES.includes(d.category) ||
    !["china", "global"].includes(d.region) ||
    !["专辑", "EP"].includes(d.kind) ||
    !Number.isSafeInteger(d.revision) ||
    d.revision < 1 ||
    !Number.isFinite(Date.parse(d.createdAt)) ||
    !Number.isFinite(Date.parse(d.updatedAt))
  )
    throw new Error("V0.40草稿身份或版本无效");
  for (const key of [
    "title",
    "artist",
    "year",
    "release",
    "cover",
    "summary",
    "reviewer",
  ] as const)
    if (typeof d[key] !== "string") throw new Error("专辑资料必须是文本");
  if (
    d.summary.length > 200 ||
    d.title.length > 250 ||
    d.artist.length > 200 ||
    !["4:5", "3:4", "1:1"].includes(d.cardRatio) ||
    !["paper", "ink"].includes(d.cardTheme)
  )
    throw new Error("专辑文本或卡片格式无效");
  if (
    d.cover &&
    !/^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(d.cover)
  )
    throw new Error("封面必须是嵌入图片");
  if (
    typeof d.fullAlbumListening !== "boolean" ||
    !Array.isArray(d.tracks) ||
    d.tracks.some(
      (t) =>
        !t.id ||
        typeof t.title !== "string" ||
        !Number.isFinite(t.duration) ||
        t.duration < 0,
    )
  )
    throw new Error("曲目或试听状态无效");
  for (const category of CATEGORIES) {
    const m = d.modes?.[category];
    if (
      !m ||
      typeof m.genreId !== "string" ||
      !Array.isArray(m.ratingsTicks) ||
      m.ratingsTicks.length !== 6 ||
      !Array.isArray(m.evidence) ||
      m.evidence.length !== 6 ||
      m.evidence.some((x) => typeof x !== "string") ||
      typeof m.applicabilityNote !== "string" ||
      typeof m.performanceUncertain !== "boolean"
    )
      throw new Error("两套模式草稿不完整");
    m.ratingsTicks.forEach(assertRating);
  }
  const m = d.mixed;
  if (
    !m ||
    typeof m.enabled !== "boolean" ||
    typeof m.reviewed !== "boolean" ||
    !Number.isSafeInteger(m.songShareTicks) ||
    m.songShareTicks < 1 ||
    m.songShareTicks > 199 ||
    ["rationale", "reviewer", "visionEvidence", "contextEvidence"].some(
      (k) => typeof m[k as keyof typeof m] !== "string",
    )
  )
    throw new Error("混合专辑艺术比重或审核资料无效");
  assertRating(m.visionTicks);
  assertRating(m.contextTicks);
}
export function calculate(
  draft: Draft,
  catalog: FrozenCatalog = bundledCatalog,
): Calculation {
  const result: Calculation = {
    total: null,
    scoreCents: null,
    numerator: null,
    denominator: draft.mixed?.enabled ? 40000 : 200,
    weights: {},
    errors: [],
    warnings: [],
    publishable: false,
    complete: false,
  };
  try {
    validateDraft(draft);
  } catch (e) {
    result.errors.push((e as Error).message);
    return result;
  }
  const categories: Category[] = draft.mixed.enabled
    ? [...CATEGORIES]
    : [draft.category];
  let approved = true;
  for (const category of categories) {
    const mode = draft.modes[category],
      genre = catalog.genres.find((g) => g.id === mode.genreId),
      profile = genre?.profiles[category];
    if (!genre || !profile?.weightsTicks) {
      result.errors.push(
        `${category === "song" ? "歌曲" : "乐曲"}需要选择可评分风格；索引不评分。`,
      );
      continue;
    }
    if (genre.classification === "definition_review")
      result.errors.push(`${genre.name}的定义争议尚未审定，不能评分。`);
    if (!profile.trialAllowed)
      result.errors.push(
        `${genre.name}：${profile.applicability}，原始数据禁止此组合试算。`,
      );
    try {
      assertWeights(profile.weightsTicks);
      result.weights[category] = [...profile.weightsTicks];
    } catch (e) {
      result.errors.push((e as Error).message);
    }
    if (mode.performanceUncertain)
      result.errors.push(
        "表演证据待复核：保留星级草稿，不用低星或自动重分权重替代未知。",
      );
    if (
      profile.applicability.includes("条件") &&
      !mode.applicabilityNote.trim()
    )
      result.warnings.push(
        `${genre.name}为条件适用，保存快照前请填写本作品的适用依据。`,
      );
    if (
      profile.reviewStatus !== "approved" ||
      !profile.approval?.reviewer.trim() ||
      !profile.approval.evidence?.trim() ||
      !Number.isFinite(Date.parse(profile.approval.reviewedAt))
    )
      approved = false;
    if (!approved)
      result.warnings.push(
        "当前权重为研究候选；试算和研究快照均不代表正式批准。",
      );
    const needed = draft.mixed.enabled
      ? mode.ratingsTicks.slice(0, 4)
      : mode.ratingsTicks;
    if (needed.some((t) => t === null))
      result.errors.push(
        `${category === "song" ? "歌曲" : "乐曲"}还有未评维度。`,
      );
  }
  if (draft.mixed.enabled) {
    const m = draft.mixed;
    if (!m.reviewed || !m.rationale.trim() || !m.reviewer.trim())
      result.errors.push(
        "混合专辑须人工审核作品艺术比重，填写理由与审核人；禁止直接按曲目数平均。",
      );
    if (m.visionTicks === null || m.contextTicks === null)
      result.errors.push("请在专辑层面评价一次愿景与语境。");
  }
  result.errors = [...new Set(result.errors)];
  result.warnings = [...new Set(result.warnings)];
  if (result.errors.length) return result;
  let numerator = 0;
  if (draft.mixed.enabled) {
    const share = draft.mixed.songShareTicks;
    for (const category of CATEGORIES)
      for (let i = 0; i < 4; i++)
        numerator +=
          draft.modes[category].ratingsTicks[i]! *
          result.weights[category]![i] *
          (category === "song" ? share : 200 - share);
    numerator +=
      (draft.mixed.visionTicks! * 30 + draft.mixed.contextTicks! * 30) * 200;
  } else
    numerator = draft.modes[draft.category].ratingsTicks.reduce<number>(
      (sum, tick, i) => sum + tick! * result.weights[draft.category]![i],
      0,
    );
  Object.assign(result, score(numerator, result.denominator), {
    numerator,
    complete: true,
  });
  result.publishable =
    approved &&
    draft.fullAlbumListening &&
    !!draft.reviewer.trim() &&
    categories.every(
      (category) =>
        draft.modes[category].evidence
          .slice(0, draft.mixed.enabled ? 4 : 6)
          .every((e) => e.trim()) &&
        (!catalog.genres
          .find((g) => g.id === draft.modes[category].genreId)!
          .profiles[category].applicability.includes("条件") ||
          !!draft.modes[category].applicabilityNote.trim()),
    ) &&
    (!draft.mixed.enabled ||
      (!!draft.mixed.visionEvidence.trim() &&
        !!draft.mixed.contextEvidence.trim()));
  return result;
}
export function canSnapshot(draft: Draft, calculation: Calculation) {
  return (
    calculation.complete &&
    !!draft.title.trim() &&
    !!draft.artist.trim() &&
    !calculation.warnings.some((w) => w.includes("适用依据"))
  );
}
export function ratingView(
  draft: Draft,
  category = draft.category,
): Six<number | null> {
  const ticks = [...draft.modes[category].ratingsTicks] as Six<number | null>;
  if (draft.mixed.enabled) {
    ticks[4] = draft.mixed.visionTicks;
    ticks[5] = draft.mixed.contextTicks;
  }
  return ticks;
}
