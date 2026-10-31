import {
  DIMENSIONS,
  type Family,
  type Genre,
  type Vector,
  type FirstUnit,
} from "./types";

export function assertWeights(w: Vector): void {
  if (
    !w ||
    typeof w !== "object" ||
    Object.keys(w).length !== 6 ||
    DIMENSIONS.some(
      (k) =>
        !Object.hasOwn(w, k) ||
        !Number.isInteger(w[k]) ||
        w[k] < 0 ||
        w[k] > 200,
    )
  )
    throw new Error("权重必须为六项整数半百分点 tick");
  if (
    DIMENSIONS.reduce((s, k) => s + w[k], 0) !== 200 ||
    DIMENSIONS.slice(0, 4).reduce((s, k) => s + w[k], 0) !== 140
  )
    throw new Error("权重总和须为200 tick，前四项须为140 tick");
  if (w.vision !== 30 || w.context !== 30)
    throw new Error("愿景、语境各须为30 tick（15%）");
}
export function assertRatings(r: Vector): void {
  if (
    !r ||
    typeof r !== "object" ||
    Object.keys(r).length !== 6 ||
    DIMENSIONS.some(
      (k) =>
        !Object.hasOwn(r, k) ||
        !Number.isInteger(r[k]) ||
        r[k] < 1 ||
        r[k] > 10,
    )
  )
    throw new Error(
      "六维评分必须全部为1至10的整数半星 tick；N/A 与未评分不能计分",
    );
}
export function effectiveWeights(family: Family, genre: Genre): Vector {
  if (!family || !genre || genre.family_id !== family.id)
    throw new Error("一级与二级风格不匹配");
  assertWeights(family.weights_ticks);
  if (
    genre.classification === "index_only" ||
    genre.eligibility === "index_only" ||
    genre.weight_mode === "none"
  )
    throw new Error("索引不赋权，请选择具体主风格");
  const w = { ...family.weights_ticks };
  if (genre.weight_mode === "family_delta") {
    const delta = genre.delta_ticks;
    if (
      !delta ||
      Object.keys(delta).length !== 6 ||
      DIMENSIONS.some((k) => !Number.isInteger(delta[k])) ||
      DIMENSIONS.reduce((s, k) => s + delta[k], 0) !== 0 ||
      delta.vision !== 0 ||
      delta.context !== 0
    )
      throw new Error("子风格偏移必须是六项整数零和，愿景和语境不得偏移");
    for (const k of DIMENSIONS) w[k] += delta[k];
  } else if (
    genre.weight_mode !== "family_inherited" ||
    genre.delta_ticks !== null
  ) {
    throw new Error("无效的权重继承方式");
  }
  assertWeights(w);
  if (
    !genre.effective_weight_ticks ||
    DIMENSIONS.some((k) => w[k] !== genre.effective_weight_ticks![k])
  )
    throw new Error("一级与偏移结果不等于冻结的V0.34权重");
  return w;
}
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 1000)
    throw new Error("总分无效");
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
export function computeScore(weights: Vector, ratings: Vector) {
  assertWeights(weights);
  assertRatings(ratings);
  const exactNumerator = DIMENSIONS.reduce(
    (sum, k) => sum + weights[k] * ratings[k],
    0,
  );
  // score = numerator / 200; cents = numerator / 2. Nonnegative integer HALF_UP.
  const scoreCents = Math.floor((exactNumerator + 1) / 2);
  return { scoreCents, exactNumerator, display: formatCents(scoreCents) };
}
/** Integer milliseconds keep both edges of the ±0.05-star interval exact. */
export function durationWeightedFirst(units: FirstUnit[]) {
  if (!Array.isArray(units) || units.length === 0)
    throw new Error("请填写混合专辑的曲目／独立乐段");
  let duration = 0n,
    tickDuration = 0n;
  for (const u of units) {
    if (
      !Number.isSafeInteger(u.durationMs) ||
      u.durationMs <= 0 ||
      u.durationMs > 86_400_000
    )
      throw new Error("曲目／乐段时长须为有效的正毫秒数");
    if (
      !Number.isInteger(u.ratingTicks) ||
      u.ratingTicks! < 1 ||
      u.ratingTicks! > 10
    )
      throw new Error("曲目／乐段首维评分须为半星");
    if (!["lyrics", "expression"].includes(u.mode))
      throw new Error("曲目／乐段首维模式无效");
    duration += BigInt(u.durationMs);
    tickDuration += BigInt(u.durationMs) * BigInt(u.ratingTicks!);
  }
  const lower = tickDuration / duration;
  const signedDistance = 2n * tickDuration - (2n * lower + 1n) * duration;
  const distance = signedDistance < 0n ? -signedDistance : signedDistance;
  const needsManualMidpointReview = distance * 5n <= duration;
  const candidateTicks = needsManualMidpointReview
    ? null
    : Number((2n * tickDuration + duration) / (2n * duration));
  return {
    referenceStars: Number(tickDuration) / Number(duration) / 2,
    candidateTicks,
    needsManualMidpointReview,
    advisoryOnly: true as const,
  };
}
