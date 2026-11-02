import { DIMENSIONS as DISPLAY_AXES } from "../model/types";
import {
  NAMES,
  ENGLISH,
  CATEGORY_LABELS,
  type Draft,
  type Snapshot,
  type Catalog,
} from "../model/v040/types";
import { calculate, ratingView } from "../model/v040/engine";
import type { ScoreCardData } from "./scoreCardData";
import { csvCell } from "./exports";

/** Adapts display axes only. Persisted v0.40 data never uses legacy semantics. */
export function cardData(
  draft: Draft,
  catalog: Catalog,
  snapshot?: Snapshot | null,
): ScoreCardData {
  const c = snapshot?.calculation ?? calculate(draft, catalog),
    category = draft.category;
  const frozenCatalog = snapshot?.catalogSnapshot ?? catalog;
  const weights = c.weights[category];
  const metadata = {
    modelVersion: draft.modelVersion,
    dimensionDefinitionsVersion: draft.dimensionDefinitionsVersion,
    weightVersion: frozenCatalog.weightVersion,
    sourceSha256: frozenCatalog.sourceSha256,
    category,
    weightsSnapshotTicks: c.weights,
    ratingsTicks: Object.fromEntries(
      Object.entries(draft.modes).map(([k, v]) => [k, v.ratingsTicks]),
    ),
    mixed: draft.mixed,
    reviewStatus: snapshot?.status ?? "research_only",
    snapshotId: snapshot?.id ?? null,
  };
  const ticks = ratingView(draft);
  return {
    schemaVersion: 1,
    album: {
      id: draft.id,
      revision: draft.revision,
      title: draft.title,
      artist: draft.artist,
      year: draft.year,
      release: draft.release,
      kind: draft.kind,
      cover: draft.cover,
    },
    score: {
      total: c.total,
      exactTotal:
        c.numerator === null ? null : `${c.numerator}/${c.denominator}`,
    },
    ratings: Object.fromEntries(
      DISPLAY_AXES.map((key, i) => [
        key,
        { value: ticks[i] === null ? null : ticks[i]! / 2 },
      ]),
    ) as ScoreCardData["ratings"],
    dimensionLabels: Object.fromEntries(
      DISPLAY_AXES.map((k, i) => [k, NAMES[category][i]]),
    ) as ScoreCardData["dimensionLabels"],
    dimensionEnglish: Object.fromEntries(
      DISPLAY_AXES.map((k, i) => [k, ENGLISH[category][i]]),
    ) as ScoreCardData["dimensionEnglish"],
    axisWeights: weights?.map((w) => String(w / 2)),
    summary: draft.summary,
    reviewer: draft.reviewer,
    updatedAt: draft.updatedAt,
    research: {
      badge: snapshot?.status === 'published' ? '已审定评分' : '个人评分 · 权重待审',
      metadata,
      lines: [
        `${CATEGORY_LABELS[category]} · ${draft.modelVersion}`,
        draft.mixed.enabled ? '混合专辑 · 按人工艺术比重评价' : '六维星级 · 整张专辑',
        snapshot ? `保存于 ${snapshot.createdAt.slice(0, 10)}` : '实时预览',

      ],
    },
  };
}
export function evaluationCSV(
  draft: Draft,
  catalog: Catalog,
  snapshot?: Snapshot | null,
) {
  const c = snapshot?.calculation ?? calculate(draft, catalog);
  const rows: unknown[][] = [
    [
      "专辑",
      "艺人",
      "模型",
      "权重版本",
      "模式",
      "维度",
      "半星ticks",
      "半百分点权重ticks",
      "证据",
      "总分",
      "状态",
      "快照ID",
    ],
  ];
  for (const category of draft.mixed.enabled
    ? (["song", "instrumental"] as const)
    : [draft.category]) {
    for (let i = 0; i < (draft.mixed.enabled ? 4 : 6); i++)
      rows.push([
        draft.title,
        draft.artist,
        draft.modelVersion,
        snapshot?.weightVersion ?? catalog.weightVersion,
        CATEGORY_LABELS[category],
        NAMES[category][i],
        draft.modes[category].ratingsTicks[i],
        c.weights[category]?.[i],
        draft.modes[category].evidence[i],
        c.total,
        snapshot?.status ?? "research_only",
        snapshot?.id ?? "",
      ]);
  }
  if (draft.mixed.enabled)
    for (const [label, ticks, evidence] of [
      ["愿景", draft.mixed.visionTicks, draft.mixed.visionEvidence],
      ["语境", draft.mixed.contextTicks, draft.mixed.contextEvidence],
    ])
      rows.push([
        draft.title,
        draft.artist,
        draft.modelVersion,
        snapshot?.weightVersion ?? catalog.weightVersion,
        "专辑一次",
        label,
        ticks,
        30,
        evidence,
        c.total,
        snapshot?.status ?? "research_only",
        snapshot?.id ?? "",
      ]);
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
