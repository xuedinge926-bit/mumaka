import type { Dimension as LegacyDimension } from "../model/types";
import {
  DIMENSIONS,
  labels,
  type ResearchDraft,
  type ResearchSnapshot,
  type Vector,
} from "../model/v035/types";
import { genreById, sourceFiles } from "../model/v035/catalog";
import { calculateResearch } from "../model/v035/engine";
import type { ScoreCardData } from "./scoreCardData";
import { csvCell } from "./exports";

const renderKey = (key: (typeof DIMENSIONS)[number]): LegacyDimension =>
  key === "first" ? "lyrics" : key;
/** The old renderer key is a display adapter only; persisted new ratings always use `first`. */
export function researchCardData(
  album: ResearchDraft,
  snapshot?: ResearchSnapshot | null,
): ScoreCardData {
  const current = snapshot ? null : calculateResearch(album);
  const weights: Vector | null =
    snapshot?.weightsSnapshotTicks ?? current?.weights ?? null;
  const score = snapshot
    ? { display: snapshot.display, exactNumerator: snapshot.exactNumerator }
    : current?.score;
  const naming = labels(snapshot?.firstMode ?? album.firstMode);
  const genre = snapshot?.genre ?? genreById.get(album.coreGenreId);
  return {
    schemaVersion: 1,
    album: {
      id: album.id,
      revision: album.revision,
      title: album.title,
      artist: album.artist,
      year: album.year,
      release: album.release,
      kind: album.kind,
      cover: album.cover,
    },
    score: {
      total: score?.display ?? null,
      exactTotal: score ? `${score.exactNumerator}/200` : null,
    },
    ratings: Object.fromEntries(
      DIMENSIONS.map((k) => [
        renderKey(k),
        { value: album.ratings[k] === null ? null : album.ratings[k]! / 2 },
      ]),
    ) as ScoreCardData["ratings"],
    dimensionLabels: Object.fromEntries(
      DIMENSIONS.map((k) => [renderKey(k), naming[k].zh]),
    ) as Record<LegacyDimension, string>,
    dimensionEnglish: Object.fromEntries(
      DIMENSIONS.map((k) => [renderKey(k), naming[k].en]),
    ) as Record<LegacyDimension, string>,
    axisWeights: weights
      ? DIMENSIONS.map((k) => String(weights[k] / 2))
      : DIMENSIONS.map(() => "—"),
    summary: album.summary,
    reviewer: album.reviewer,
    updatedAt: album.updatedAt,
    modelProvenance: snapshot?.provenance ?? {
      modelVersion: album.modelVersion,
      weightVersion: album.weightVersion,
      sourceFiles,
    },
    research: {
      badge: "研究评分 · 未审定",
      lines: [
        `${genre ? `${genre.name_zh} / ${genre.name_en}` : "未选择主风格"} · ${album.coreGenreId}`,
        `${album.modelVersion} · ${album.weightVersion} · research_candidate`,
        `六维证据 ${DIMENSIONS.filter((k) => album.evidence[k].status === "supported").length}/6 · ${snapshot ? "不可变研究快照" : "草稿预览"} · 未获正式发布批准`,
      ],
      metadata: snapshot ?? { album, sourceFiles },
    },
  };
}
export function snapshotJSON(snapshot: ResearchSnapshot): string {
  return JSON.stringify(
    { format: "mumaka-research-revision", schemaVersion: 1, snapshot },
    null,
    2,
  );
}
export function snapshotCSV(snapshot: ResearchSnapshot): string {
  const d = snapshot.album,
    naming = labels(snapshot.firstMode);
  const rows: unknown[][] = [
    [
      "快照ID",
      "专辑",
      "音乐人",
      "主风格ID",
      "模型版本",
      "权重版本",
      "审核状态",
      "第一维模式",
      "总分",
      "维度",
      "English",
      "半星tick",
      "星级",
      "半百分点tick",
      "权重%",
      "证据状态",
      "正例",
      "反例",
      "理由",
      "相邻档位",
      "快照SHA256",
      "不可变快照JSON",
    ],
  ];
  for (const k of DIMENSIONS)
    rows.push([
      snapshot.id,
      d.title,
      d.artist,
      snapshot.coreGenreId,
      snapshot.modelVersion,
      snapshot.weightVersion,
      "research_candidate / research_only",
      snapshot.firstMode,
      snapshot.display,
      naming[k].zh,
      naming[k].en,
      snapshot.ratingsSnapshotTicks[k],
      snapshot.ratingsSnapshotTicks[k] / 2,
      snapshot.weightsSnapshotTicks[k],
      snapshot.weightsSnapshotTicks[k] / 2,
      d.evidence[k].status,
      d.evidence[k].support,
      d.evidence[k].counterexample,
      d.evidence[k].rationale,
      d.evidence[k].adjacentGrade,
      snapshot.integrityHash,
      JSON.stringify(snapshot),
    ]);
  return "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}
