import { createId } from "../../lib/browserCrypto";
import type { Album, AlbumImportSource } from "../types";

export const MODEL_VERSION = "v0.40.0" as const;
export const DEFINITIONS_VERSION = "v0.40-six-dimensions-1" as const;
export const CATEGORIES = ["song", "instrumental"] as const;
export type Category = (typeof CATEGORIES)[number];
export const AXES = [
  "primary",
  "secondary",
  "performance",
  "production",
  "vision",
  "context",
] as const;
export type Axis = (typeof AXES)[number];
export type Six<T> = [T, T, T, T, T, T];
export const six = <T>(fn: (axis: Axis, i: number) => T) =>
  AXES.map(fn) as Six<T>;
export const CATEGORY_LABELS = { song: "歌曲", instrumental: "乐曲" };
export const NAMES: Record<Category, Six<string>> = {
  song: ["歌词", "作曲", "表演", "制作", "愿景", "语境"],
  instrumental: ["素材", "结构", "表演", "制作", "愿景", "语境"],
};
export const ENGLISH: Record<Category, Six<string>> = {
  song: [
    "Lyrics",
    "Composition",
    "Performance",
    "Production",
    "Vision",
    "Context",
  ],
  instrumental: [
    "Material",
    "Structure",
    "Performance",
    "Production",
    "Vision",
    "Context",
  ],
};
export interface Profile {
  weightsTicks: Six<number> | null;
  applicability: string;
  trialAllowed: boolean;
  source: string;
  rationale: string;
  reviewStatus: string;
  sourceSheet: string;
  sourceRow: number;
  approval?: { reviewer: string; reviewedAt: string; evidence: string };
}
export interface Genre {
  id: string;
  name: string;
  nameEn: string;
  familyId: string;
  classification:
    | "independent_candidate"
    | "general_entry"
    | "index_only"
    | "definition_review";
  profiles: Record<Category, Profile>;
}
export interface Family {
  id: string;
  name: string;
  nameEn: string;
  profiles: Record<
    Category,
    { weightsTicks: Six<number>; rationale: string; sourceRow: number }
  >;
}
export interface Anchor {
  workId?: string;
  primaryArtistId?: string;
  confidence?: string;
  selectionRationale?: string;
  coverSource?: string;
  coverLicense?: string;
  manualVersion?: string;
  manualTitle?: string;
  manualLocked?: boolean;
  manualResolution?: string;
  identityNote?: string;
  referenceEditedAt?: string;
  mainGenre?: string;
  displayStandard?: string;
  coverUrl?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  id: string;
  region: "china" | "global";
  category: Category;
  dimension: string;
  stars: number;
  album: string;
  artist: string;
  year: string;
  feature: string;
  standard: string;
  include: string;
  exclude: string;
  lower: string;
  upper: string;
  comparison: string;
  risk: string;
  listening: string;
  approved: boolean;
  status: string;
  version: string;
  sourceSheet: string;
  sourceRow: number;
  sources: string[];
  evidence?: string;
  auditExtent?: string;
  edition?: string;
  pending?: string;
  sourceText?: string;
  unassigned?: boolean;
}
export interface Catalog {
  referenceVersion?: string;
  referenceConflicts?: { id: string; reason: string; previous: Anchor }[];
  schemaVersion: 1;
  sourceVersion: string;
  weightVersion: string;
  sourceSha256: string;
  r3Sha256: string | null;
  publicRelease: string;
  families: Family[];
  genres: Genre[];
  anchors: Anchor[];
}
export interface ModeDraft {
  genreId: string;
  ratingsTicks: Six<number | null>;
  evidence: Six<string>;
  applicabilityNote: string;
  performanceUncertain: boolean;
}
export interface Draft {
  schemaVersion: 2;
  id: string;
  modelVersion: typeof MODEL_VERSION;
  dimensionDefinitionsVersion: typeof DEFINITIONS_VERSION;
  title: string;
  artist: string;
  year: string;
  release: string;
  kind: "专辑" | "EP";
  cover: string;
  region: "china" | "global";
  category: Category;
  modes: Record<Category, ModeDraft>;
  mixed: {
    enabled: boolean;
    songShareTicks: number;
    rationale: string;
    reviewed: boolean;
    reviewer: string;
    visionTicks: number | null;
    contextTicks: number | null;
    visionEvidence: string;
    contextEvidence: string;
  };
  tracks: { id: string; title: string; duration: number }[];
  summary: string;
  reviewer: string;
  fullAlbumListening: boolean;
  cardRatio: "4:5" | "3:4" | "1:1";
  cardTheme: "paper" | "ink";
  createdAt: string;
  updatedAt: string;
  revision: number;
  importSource?: AlbumImportSource;
  spotify?: Album["spotify"];
  parent?: { modelVersion: string; albumId: string; snapshotId?: string };
}
export interface Calculation {
  total: string | null;
  scoreCents: number | null;
  numerator: number | null;
  denominator: number;
  weights: Partial<Record<Category, Six<number>>>;
  errors: string[];
  warnings: string[];
  publishable: boolean;
  complete: boolean;
}
export interface FrozenCatalog {
  sourceVersion: string;
  weightVersion: string;
  sourceSha256: string;
  genres: Genre[];
}
export interface Snapshot {
  schemaVersion: 2;
  id: string;
  albumId: string;
  createdAt: string;
  modelVersion: typeof MODEL_VERSION;
  dimensionDefinitionsVersion: typeof DEFINITIONS_VERSION;
  weightVersion: string;
  category: Category;
  status: "research_only" | "published";
  draft: Draft;
  calculation: Calculation;
  catalogSnapshot: FrozenCatalog;
  approval?: {
    reviewer: string;
    approvedAt: string;
    action: "explicit_manual_publication";
  };
  integrityHash: string;
}

export function newDraft(): Draft {
  const now = new Date().toISOString();
  const mode = (): ModeDraft => ({
    genreId: "",
    ratingsTicks: six(() => null),
    evidence: six(() => ""),
    applicabilityNote: "",
    performanceUncertain: false,
  });
  return {
    schemaVersion: 2,
    id: createId(),
    modelVersion: MODEL_VERSION,
    dimensionDefinitionsVersion: DEFINITIONS_VERSION,
    title: "",
    artist: "",
    year: "",
    release: "",
    kind: "专辑",
    cover: "",
    region: "china",
    category: "song",
    modes: { song: mode(), instrumental: mode() },
    mixed: {
      enabled: false,
      songShareTicks: 100,
      rationale: "",
      reviewed: false,
      reviewer: "",
      visionTicks: null,
      contextTicks: null,
      visionEvidence: "",
      contextEvidence: "",
    },
    tracks: [],
    summary: "",
    reviewer: "",
    fullAlbumListening: false,
    cardRatio: "4:5",
    cardTheme: "paper",
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };
}
/** Reuse metadata only; legacy dimensions, ratings and weights are never mapped. */
export function fromLegacy(album: Album, snapshotId?: string): Draft {
  return {
    ...newDraft(),
    title: album.title,
    artist: album.artist,
    year: album.year,
    release: album.release,
    kind: album.kind,
    cover: album.cover,
    region: album.ux?.market ?? "china",
    tracks: album.tracks.map((t) => ({
      id: t.id,
      title: t.title,
      duration: t.duration,
    })),
    ...(album.importSource
      ? { importSource: structuredClone(album.importSource) }
      : {}),
    ...(album.spotify ? { spotify: structuredClone(album.spotify) } : {}),
    parent: {
      modelVersion: "v0.19",
      albumId: album.id,
      ...(snapshotId ? { snapshotId } : {}),
    },
  };
}
