import {
  DIMENSIONS,
  type Album,
  type Calculation,
  type Dimension,
  type Rating,
} from "../model/types";

/** Versioned, display-only boundary for the existing card and a future editor. */
export interface ScoreCardData {
  schemaVersion: 1;
  album: {
    id: string;
    revision: number;
    title: string;
    artist: string;
    year: string;
    release: string;
    kind: Album["kind"];
    cover: string;
  };
  score: { total: string | null; exactTotal: string | null };
  ratings: Record<Dimension, { value: Rating["value"] }>;
  summary: string;
  reviewer: string;
  updatedAt: string;
  modelProvenance?: unknown;
  dimensionLabels?: Record<Dimension, string>;
  dimensionEnglish?: Record<Dimension, string>;
  axisWeights?: string[];
  research?: { badge: string; lines: string[]; metadata: unknown };
}

/** No calculation, migration, or write. A historic result is passed through verbatim. */
export function toScoreCardData(
  album: Album,
  calculation: Calculation,
  modelProvenance?: unknown,
): ScoreCardData {
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
    score: { total: calculation.total, exactTotal: calculation.exactTotal },
    ratings: Object.fromEntries(
      DIMENSIONS.map((d) => [d, { value: album.ratings[d].value }]),
    ) as ScoreCardData["ratings"],
    summary: album.summary,
    reviewer: album.reviewer,
    updatedAt: album.updatedAt,
    ...(modelProvenance === undefined
      ? {}
      : { modelProvenance: structuredClone(modelProvenance) }),
  };
}
