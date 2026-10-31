import { createId } from "../../lib/browserCrypto";
import type { Album, AlbumImportSource } from "../types";

export const DIMENSIONS = [
  "first",
  "composition",
  "performance",
  "sound",
  "vision",
  "context",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export type FirstMode = "lyrics" | "expression" | "mixed";
export type Vector = Record<Dimension, number>;
export const MODEL_VERSION = "v0.35-rc1" as const;
export const WEIGHT_VERSION = "v0.34-research-candidate" as const;
export const FIRST_LABELS = {
  lyrics: { zh: "歌词", en: "Lyrics" },
  expression: { zh: "表意", en: "Expression" },
  mixed: { zh: "歌词／表意", en: "Lyrics / Expression" },
} as const;
export const FIXED_LABELS = {
  composition: { zh: "作曲", en: "Composition" },
  performance: { zh: "表演", en: "Performance" },
  sound: { zh: "声音", en: "Sound" },
  vision: { zh: "愿景", en: "Vision" },
  context: { zh: "语境", en: "Context" },
} as const;
export type Classification =
  | "independent_candidate"
  | "general_entry"
  | "index_only"
  | "definition_review";
export interface Family {
  id: string;
  name_zh: string;
  name_en: string;
  display_order: number;
  weights_ticks: Vector;
  review_status: string;
  rationale: string;
  evidence_grade: string;
  navigation_only_family: boolean;
  source_workbook: string;
  source_sheet: string;
  source_row: number;
}
export interface Genre {
  id: string;
  family_id: string;
  name_zh: string;
  name_en: string;
  display_order: number;
  classification: Classification;
  eligibility:
    | "internal_trial_only"
    | "index_only"
    | "blocked_pending_classification";
  review_status: string;
  priority: string;
  weight_mode: "family_inherited" | "family_delta" | "none";
  delta_ticks: Vector | null;
  effective_weight_ticks: Vector | null;
  reason: string;
  controversy: string;
  recheck_method: string;
  mapping_note: string;
  historical: {
    v034_review_method: string;
    old_zh_alias: string | null;
    [key: string]: unknown;
  };
  in_first_wave_46: boolean;
  source_row: number;
}
export interface WeightProfile {
  id: string;
  genreId: string;
  weightVersion: typeof WEIGHT_VERSION;
  reviewStatus: "research_candidate";
  weightsTicks: Vector;
}
export interface Evidence {
  support: string;
  counterexample: string;
  rationale: string;
  adjacentGrade: string;
  status: "unreviewed" | "supported" | "insufficient";
}
export interface FirstUnit {
  id: string;
  trackId: string;
  title: string;
  durationMs: number;
  mode: "lyrics" | "expression";
  ratingTicks: number | null;
  evidence: string;
}
export interface ResearchDraft {
  id: string;
  modelVersion: typeof MODEL_VERSION;
  weightVersion: typeof WEIGHT_VERSION;
  title: string;
  artist: string;
  year: string;
  release: string;
  cover: string;
  kind: "专辑" | "EP";
  coreGenreId: string;
  auxiliaryGenreIds: string[];
  explicitResearchOverride: boolean;
  firstMode: FirstMode;
  ratings: Record<Dimension, number | null>;
  evidence: Record<Dimension, Evidence>;
  firstUnits: FirstUnit[];
  firstVerdict: string;
  midpointReviewed: boolean;
  fullAlbumListeningVerified: boolean;
  sourceEditionVerified: boolean;
  reviewer: string;
  summary: string;
  status: "draft" | "research_only" | "in_review";
  createdAt: string;
  updatedAt: string;
  revision: number;
  parent?: {
    modelVersion: string;
    albumId: string;
    snapshotId?: string;
    score?: string | null;
  };
  tracks: { id: string; title: string; duration: number }[];
  importSource?: AlbumImportSource;
  spotify?: Album["spotify"];
  cardRatio: "4:5" | "3:4" | "1:1";
  cardTheme: "paper" | "ink";
}
export interface ResearchSnapshot {
  id: string;
  albumId: string;
  createdAt: string;
  modelVersion: typeof MODEL_VERSION;
  weightVersion: typeof WEIGHT_VERSION;
  coreGenreId: string;
  profileStatus: "research_candidate";
  status: "research_only";
  publishable: false;
  firstMode: FirstMode;
  weightsSnapshotTicks: Vector;
  ratingsSnapshotTicks: Vector;
  scoreCents: number;
  exactNumerator: number;
  display: string;
  album: ResearchDraft;
  genre: Genre;
  family: Family;
  provenance: { catalogHash: string; sourceFiles: Record<string, string> };
  integrityHash: string;
}

export function labels(mode: FirstMode) {
  if (!Object.hasOwn(FIRST_LABELS, mode)) throw new Error("第一维模式无效");
  return { first: FIRST_LABELS[mode], ...FIXED_LABELS };
}
export function newResearchDraft(): ResearchDraft {
  const now = new Date().toISOString();
  return {
    id: createId(),
    modelVersion: MODEL_VERSION,
    weightVersion: WEIGHT_VERSION,
    title: "",
    artist: "",
    year: "",
    release: "",
    cover: "",
    kind: "专辑",
    coreGenreId: "",
    auxiliaryGenreIds: [],
    explicitResearchOverride: false,
    firstMode: "lyrics",
    ratings: Object.fromEntries(
      DIMENSIONS.map((k) => [k, null]),
    ) as ResearchDraft["ratings"],
    evidence: Object.fromEntries(
      DIMENSIONS.map((k) => [
        k,
        {
          support: "",
          counterexample: "",
          rationale: "",
          adjacentGrade: "",
          status: "unreviewed",
        },
      ]),
    ) as ResearchDraft["evidence"],
    firstUnits: [],
    firstVerdict: "",
    midpointReviewed: false,
    fullAlbumListeningVerified: false,
    sourceEditionVerified: false,
    reviewer: "",
    summary: "",
    status: "draft",
    createdAt: now,
    updatedAt: now,
    revision: 1,
    tracks: [],
    cardRatio: "4:5",
    cardTheme: "paper",
  };
}

/** Metadata is reusable; legacy ratings, N/A, corrections and evidence are never converted. */
export function fromLegacy(
  album: Album,
  snapshotId?: string,
  score?: string | null,
  sourceModelVersion = "v0.19",
): ResearchDraft {
  return {
    ...newResearchDraft(),
    title: album.title,
    artist: album.artist,
    year: album.year,
    release: album.release,
    cover: album.cover,
    kind: album.kind,
    tracks: album.tracks.map((t) => ({
      id: t.id,
      title: t.title,
      duration: t.duration,
    })),
    parent: {
      modelVersion: sourceModelVersion,
      albumId: album.id,
      ...(snapshotId ? { snapshotId } : {}),
      ...(score === undefined ? {} : { score }),
    },
    ...(album.importSource
      ? { importSource: structuredClone(album.importSource) }
      : {}),
    ...(album.spotify ? { spotify: structuredClone(album.spotify) } : {}),
  };
}
