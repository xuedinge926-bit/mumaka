import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { createId, sha256Hex } from "./browserCrypto";
import { exportBackup as exportLegacyBackup } from "./storage";
import { calculateResearch, validateDraft } from "../model/v035/engine";
import {
  families,
  genres,
  weightProfiles,
  sourceFiles,
  validateCatalog,
  familyById,
  genreById,
} from "../model/v035/catalog";
import {
  MODEL_VERSION,
  WEIGHT_VERSION,
  type ResearchDraft,
  type ResearchSnapshot,
  type WeightProfile,
  type Family,
  type Genre,
} from "../model/v035/types";
import { computeScore, effectiveWeights } from "../model/v035/math";

export const SHADOW_DB = "mumaka-v035-shadow";
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
const digest = (value: unknown) => sha256Hex(canonical(value));
const clone = <T>(x: T): T => structuredClone(x);
const fail = (message: string): never => {
  throw new Error(message);
};
interface CatalogVersion {
  id: string;
  hash: string;
  createdAt: string;
  counts: ReturnType<typeof validateCatalog>;
}
interface FamilyVersion {
  id: string;
  weightVersion: string;
  familyId: string;
  record: Family;
}
interface GenreVersion {
  id: string;
  weightVersion: string;
  genreId: string;
  record: Genre;
}
export interface LegacyCheckpoint {
  id: string;
  createdAt: string;
  origin: string;
  database: "nmc-workbench-v1";
  schemaVersion: 1;
  json: string;
  fileHash: string;
  contentHash: string;
  albums: number;
  snapshots: number;
}
interface Audit {
  id: string;
  createdAt: string;
  action: string;
  catalogVersion: string;
  checkpointId?: string;
}
interface ShadowDB extends DBSchema {
  catalogs: { key: string; value: CatalogVersion };
  families: { key: string; value: FamilyVersion };
  genres: { key: string; value: GenreVersion };
  profiles: { key: string; value: WeightProfile };
  checkpoints: { key: string; value: LegacyCheckpoint };
  drafts: { key: string; value: ResearchDraft };
  revisions: {
    key: string;
    value: ResearchSnapshot;
    indexes: { albumId: string };
  };
  meta: { key: string; value: { id: string; value: string | null } };
  audit: { key: string; value: Audit };
}
const STORES = [
  "catalogs",
  "families",
  "genres",
  "profiles",
  "checkpoints",
  "drafts",
  "revisions",
  "meta",
  "audit",
] as const;
function db(): Promise<IDBPDatabase<ShadowDB>> {
  return openDB<ShadowDB>(SHADOW_DB, 1, {
    upgrade(database) {
      for (const store of STORES) {
        if (store === "revisions")
          database
            .createObjectStore("revisions", { keyPath: "id" })
            .createIndex("albumId", "albumId");
        else database.createObjectStore(store, { keyPath: "id" });
      }
    },
  });
}
const catalogHash = () =>
  digest({ families, genres, profiles: weightProfiles });
function legacyContent(json: string) {
  const value = JSON.parse(json);
  if (
    value.format !== "nmc-library" ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.albums) ||
    !Array.isArray(value.snapshots)
  )
    fail("旧库备份格式无效");
  return { albums: value.albums, snapshots: value.snapshots };
}
/** Reads the CURRENT origin. An empty local origin is never called a backup of the original website. */
export async function createLegacyCheckpoint(): Promise<LegacyCheckpoint> {
  const json = await exportLegacyBackup(),
    content = legacyContent(json);
  return {
    id: createId(),
    createdAt: new Date().toISOString(),
    origin:
      typeof location === "undefined"
        ? "test-only://fake-indexeddb"
        : location.origin,
    database: "nmc-workbench-v1",
    schemaVersion: 1,
    json,
    fileHash: await sha256Hex(json),
    contentHash: await digest(content),
    albums: content.albums.length,
    snapshots: content.snapshots.length,
  };
}
async function verifyCheckpoint(checkpoint: LegacyCheckpoint) {
  const currentOrigin =
    typeof location === "undefined"
      ? "test-only://fake-indexeddb"
      : location.origin;
  if (
    !checkpoint ||
    checkpoint.database !== "nmc-workbench-v1" ||
    checkpoint.schemaVersion !== 1 ||
    checkpoint.origin !== currentOrigin ||
    (await sha256Hex(checkpoint.json)) !== checkpoint.fileHash ||
    (await digest(legacyContent(checkpoint.json))) !== checkpoint.contentHash
  )
    fail("旧库备份校验失败或来自其他地址，请重新导出当前地址的旧库");
  const captured = legacyContent(checkpoint.json);
  if (
    !checkpoint.id ||
    !Number.isFinite(Date.parse(checkpoint.createdAt)) ||
    captured.albums.length !== checkpoint.albums ||
    captured.snapshots.length !== checkpoint.snapshots
  )
    fail("旧库备份数量或元数据校验失败");
  const current = await createLegacyCheckpoint();
  if (current.contentHash !== checkpoint.contentHash)
    fail("旧库自备份后发生变化，请重新备份后启用");
}
export async function researchState() {
  const database = await db();
  try {
    const tx = database.transaction(
      ["meta", "catalogs", "drafts", "revisions"],
      "readonly",
    );
    const [active, catalog, drafts, revisions] = await Promise.all([
      tx.objectStore("meta").get("active"),
      tx.objectStore("catalogs").get(WEIGHT_VERSION),
      tx.objectStore("drafts").getAll(),
      tx.objectStore("revisions").getAll(),
    ]);
    await tx.done;
    drafts.forEach(validateDraft);
    for (const revision of revisions) await validateResearchSnapshot(revision);
    return {
      active: active?.value === WEIGHT_VERSION,
      catalog,
      drafts: drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      revisions: revisions.sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
    };
  } finally {
    database.close();
  }
}
/** All catalog stores commit together. Old stores live in a different DB and are never written here. */
export async function installResearchCatalog(
  checkpoint: LegacyCheckpoint,
): Promise<void> {
  validateCatalog();
  await verifyCheckpoint(checkpoint);
  const hash = await catalogHash(),
    now = new Date().toISOString(),
    database = await db();
  let inserted = false;
  try {
    const tx = database.transaction(
      [
        "catalogs",
        "families",
        "genres",
        "profiles",
        "checkpoints",
        "meta",
        "audit",
      ],
      "readwrite",
    );
    try {
      const existing = await tx.objectStore("catalogs").get(WEIGHT_VERSION);
      if (existing && existing.hash !== hash)
        fail("已有同版本目录内容冲突，禁止覆盖");
      const expectedFamilies = families.map((f) => ({
        id: `${WEIGHT_VERSION}:${f.id}`,
        weightVersion: WEIGHT_VERSION,
        familyId: f.id,
        record: clone(f),
      }));
      const expectedGenres = genres.map((g) => ({
        id: `${WEIGHT_VERSION}:${g.id}`,
        weightVersion: WEIGHT_VERSION,
        genreId: g.id,
        record: clone(g),
      }));
      for (const [store, values] of [
        ["families", expectedFamilies],
        ["genres", expectedGenres],
        ["profiles", weightProfiles],
      ] as const) {
        for (const value of values) {
          const previous = await tx.objectStore(store).get(value.id);
          if (previous && canonical(previous) !== canonical(value))
            fail("shadow目录记录冲突，整个导入已撤回");
          if (!previous) await tx.objectStore(store).add(clone(value));
        }
      }
      const previousCheckpoint = await tx
        .objectStore("checkpoints")
        .get(checkpoint.id);
      if (
        previousCheckpoint &&
        canonical(previousCheckpoint) !== canonical(checkpoint)
      )
        fail("备份ID冲突");
      if (!previousCheckpoint)
        await tx.objectStore("checkpoints").add(clone(checkpoint));
      if (!existing) {
        await tx
          .objectStore("catalogs")
          .add({
            id: WEIGHT_VERSION,
            hash,
            createdAt: now,
            counts: validateCatalog(),
          });
        inserted = true;
      }
      // Inactive staging precedes the post-import legacy checksum check.
      await tx.objectStore("meta").put({ id: "active", value: null });
      await tx
        .objectStore("audit")
        .add({
          id: createId(),
          createdAt: now,
          action: "catalog_staged",
          catalogVersion: WEIGHT_VERSION,
          checkpointId: checkpoint.id,
        });
      await tx.done;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* already closed */
      }
      await tx.done.catch(() => undefined);
      throw error;
    }
    try {
      await verifyCheckpoint(checkpoint);
    } catch (error) {
      // Preserve every review and checkpoint; a new, unactivated catalog can be removed atomically.
      const rollback = database.transaction(
        ["catalogs", "families", "genres", "profiles", "meta", "audit"],
        "readwrite",
      );
      if (inserted) {
        await rollback.objectStore("catalogs").delete(WEIGHT_VERSION);
        for (const f of families)
          await rollback
            .objectStore("families")
            .delete(`${WEIGHT_VERSION}:${f.id}`);
        for (const g of genres)
          await rollback
            .objectStore("genres")
            .delete(`${WEIGHT_VERSION}:${g.id}`);
        for (const p of weightProfiles)
          await rollback.objectStore("profiles").delete(p.id);
      }
      await rollback.objectStore("meta").put({ id: "active", value: null });
      await rollback
        .objectStore("audit")
        .add({
          id: createId(),
          createdAt: new Date().toISOString(),
          action: "catalog_failed_legacy_check",
          catalogVersion: WEIGHT_VERSION,
        });
      await rollback.done;
      throw error;
    }
    const activate = database.transaction(["meta", "audit"], "readwrite");
    await activate
      .objectStore("meta")
      .put({ id: "active", value: WEIGHT_VERSION });
    await activate
      .objectStore("audit")
      .add({
        id: createId(),
        createdAt: new Date().toISOString(),
        action: "catalog_activated",
        catalogVersion: WEIGHT_VERSION,
        checkpointId: checkpoint.id,
      });
    await activate.done;
  } finally {
    database.close();
  }
}
/** Reversible deactivation. It never deletes drafts, revisions, checkpoints or legacy data. */
export async function deactivateResearchCatalog() {
  await flushResearchWrites();
  const database = await db();
  try {
    const tx = database.transaction(["meta", "audit"], "readwrite");
    await tx.objectStore("meta").put({ id: "active", value: null });
    await tx
      .objectStore("audit")
      .add({
        id: createId(),
        createdAt: new Date().toISOString(),
        action: "catalog_deactivated",
        catalogVersion: WEIGHT_VERSION,
      });
    await tx.done;
  } finally {
    database.close();
  }
}
let writes: Promise<void> = Promise.resolve();
export const flushResearchWrites = () => writes;
export function saveResearchDraft(draft: ResearchDraft): Promise<void> {
  const captured = clone(draft);
  validateDraft(captured);
  const task = writes
    .catch(() => undefined)
    .then(async () => {
      const database = await db();
      try {
        const tx = database.transaction(["meta", "drafts"], "readwrite");
        if (
          (await tx.objectStore("meta").get("active"))?.value !== WEIGHT_VERSION
        ) {
          tx.abort();
          await tx.done.catch(() => undefined);
          fail("研究目录尚未启用");
        }
        await tx.objectStore("drafts").put(captured);
        await tx.done;
      } finally {
        database.close();
      }
    });
  // Callers receive their error; a failed write does not poison later saves or the flush barrier.
  writes = task.catch(() => undefined);
  return task;
}
export async function saveResearchSnapshot(
  draft: ResearchDraft,
): Promise<ResearchSnapshot> {
  await flushResearchWrites();
  validateDraft(draft);
  const calculation = calculateResearch(draft);
  if (
    !calculation.complete ||
    !calculation.score ||
    !calculation.weights ||
    !draft.title.trim() ||
    !draft.artist.trim()
  )
    fail(
      `不能保存评分修订：${calculation.errors.join("；") || "请填写专辑名与音乐人"}`,
    );
  const genre = genreById.get(draft.coreGenreId)!,
    family = familyById.get(genre.family_id)!;
  const snapshot: ResearchSnapshot = {
    id: createId(),
    albumId: draft.id,
    createdAt: new Date().toISOString(),
    modelVersion: MODEL_VERSION,
    weightVersion: WEIGHT_VERSION,
    coreGenreId: genre.id,
    profileStatus: "research_candidate",
    status: "research_only",
    publishable: false,
    firstMode: draft.firstMode,
    weightsSnapshotTicks: clone(calculation.weights!),
    ratingsSnapshotTicks: clone(
      draft.ratings,
    ) as ResearchSnapshot["ratingsSnapshotTicks"],
    ...calculation.score!,
    album: clone(draft),
    genre: clone(genre),
    family: clone(family),
    provenance: {
      catalogHash: await catalogHash(),
      sourceFiles: clone(sourceFiles),
    },
    integrityHash: "",
  };
  snapshot.integrityHash = await digest({ ...snapshot, integrityHash: "" });
  const database = await db();
  try {
    const tx = database.transaction(
      ["meta", "catalogs", "profiles", "revisions"],
      "readwrite",
    );
    try {
      if (
        (await tx.objectStore("meta").get("active"))?.value !==
          WEIGHT_VERSION ||
        (await tx.objectStore("catalogs").get(WEIGHT_VERSION))?.hash !==
          snapshot.provenance.catalogHash
      )
        fail("研究目录未激活或校验失败");
      const profile = await tx
        .objectStore("profiles")
        .get(`${WEIGHT_VERSION}:${genre.id}`);
      if (
        !profile ||
        profile.reviewStatus !== "research_candidate" ||
        canonical(profile.weightsTicks) !==
          canonical(snapshot.weightsSnapshotTicks)
      )
        fail("权重版本校验失败");
      await tx.objectStore("revisions").add(clone(snapshot));
      await tx.done;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* already closed */
      }
      await tx.done.catch(() => undefined);
      throw error;
    }
  } finally {
    database.close();
  }
  return clone(snapshot);
}
export async function validateResearchSnapshot(snapshot: ResearchSnapshot) {
  if (
    !snapshot ||
    !snapshot.id ||
    !Number.isFinite(Date.parse(snapshot.createdAt))
  )
    fail("研究快照元数据无效");
  validateDraft(snapshot.album);
  if (
    snapshot.modelVersion !== MODEL_VERSION ||
    snapshot.weightVersion !== WEIGHT_VERSION ||
    snapshot.profileStatus !== "research_candidate" ||
    snapshot.status !== "research_only" ||
    snapshot.publishable !== false ||
    snapshot.albumId !== snapshot.album.id ||
    snapshot.coreGenreId !== snapshot.album.coreGenreId ||
    snapshot.genre.id !== snapshot.coreGenreId ||
    snapshot.firstMode !== snapshot.album.firstMode
  )
    fail("研究快照身份／审核状态无效");
  const weights = effectiveWeights(snapshot.family, snapshot.genre);
  if (
    canonical(snapshot.genre) !==
      canonical(genreById.get(snapshot.coreGenreId)) ||
    canonical(snapshot.family) !==
      canonical(familyById.get(snapshot.genre.family_id))
  )
    fail("研究快照内的冻结来源记录被改写");
  const current = calculateResearch(snapshot.album);
  const score = computeScore(
    snapshot.weightsSnapshotTicks,
    snapshot.ratingsSnapshotTicks,
  );
  if (
    !current.complete ||
    canonical(weights) !== canonical(snapshot.weightsSnapshotTicks) ||
    canonical(snapshot.album.ratings) !==
      canonical(snapshot.ratingsSnapshotTicks) ||
    score.scoreCents !== snapshot.scoreCents ||
    score.display !== snapshot.display ||
    score.exactNumerator !== snapshot.exactNumerator ||
    (await digest({ ...snapshot, integrityHash: "" })) !==
      snapshot.integrityHash ||
    snapshot.provenance.catalogHash !== (await catalogHash()) ||
    canonical(snapshot.provenance.sourceFiles) !== canonical(sourceFiles)
  )
    fail("研究快照内容校验失败");
}
type ShadowPayload = { [K in (typeof STORES)[number]]: ShadowDB[K]["value"][] };
export async function exportResearchBackup(): Promise<string> {
  await flushResearchWrites();
  const database = await db();
  try {
    const tx = database.transaction(STORES, "readonly");
    const values = await Promise.all(
      STORES.map((s) => tx.objectStore(s).getAll()),
    );
    await tx.done;
    const payload = Object.fromEntries(
      STORES.map((s, i) => [s, values[i]]),
    ) as ShadowPayload;
    return JSON.stringify(
      {
        format: "mumaka-v035-shadow",
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        payload,
        sha256: await digest(payload),
      },
      null,
      2,
    );
  } finally {
    database.close();
  }
}
/** Conflict checks and every restored store share one transaction; existing IDs are never overwritten. */
export async function importResearchBackup(
  json: string,
  checkpoint: LegacyCheckpoint,
) {
  if (json.length > 100 * 1024 * 1024) fail("备份超过100 MB");
  const backup = JSON.parse(json);
  if (
    backup.format !== "mumaka-v035-shadow" ||
    backup.schemaVersion !== 1 ||
    !backup.payload ||
    backup.sha256 !== (await digest(backup.payload)) ||
    STORES.some((s) => !Array.isArray(backup.payload[s]))
  )
    fail("研究备份格式或校验摘要不匹配");
  const payload = backup.payload as ShadowPayload;
  for (const s of STORES)
    if (
      payload[s].some((x) => !x || typeof x.id !== "string" || !x.id) ||
      new Set(payload[s].map((x) => x.id)).size !== payload[s].length
    )
      fail("备份中存在重复或无效ID");
  payload.drafts.forEach(validateDraft);
  for (const s of payload.revisions) await validateResearchSnapshot(s);
  if (
    payload.catalogs.length !== 1 ||
    payload.catalogs[0].id !== WEIGHT_VERSION ||
    payload.catalogs[0].hash !== (await catalogHash())
  )
    fail("研究目录版本／校验无效");
  validateCatalog(
    payload.families.map((f) => f.record),
    payload.genres.map((g) => g.record),
  );
  const sort = (v: { id: string }[]) =>
    [...v].sort((a, b) => a.id.localeCompare(b.id));
  if (
    canonical(sort(payload.profiles)) !== canonical(sort(weightProfiles)) ||
    canonical(sort(payload.families)) !==
      canonical(
        sort(
          families.map((f) => ({
            id: `${WEIGHT_VERSION}:${f.id}`,
            weightVersion: WEIGHT_VERSION,
            familyId: f.id,
            record: f,
          })),
        ),
      ) ||
    canonical(sort(payload.genres)) !==
      canonical(
        sort(
          genres.map((g) => ({
            id: `${WEIGHT_VERSION}:${g.id}`,
            weightVersion: WEIGHT_VERSION,
            genreId: g.id,
            record: g,
          })),
        ),
      )
  )
    fail("研究目录或权重已被改写");
  for (const c of payload.checkpoints)
    if (
      (await sha256Hex(c.json)) !== c.fileHash ||
      (await digest(legacyContent(c.json))) !== c.contentHash ||
      legacyContent(c.json).albums.length !== c.albums ||
      legacyContent(c.json).snapshots.length !== c.snapshots
    )
      fail("旧库检查点内容损坏");
  if (
    payload.meta.some(
      (m) =>
        m.id !== "active" || (m.value !== null && m.value !== WEIGHT_VERSION),
    )
  )
    fail("激活信息无效");
  await verifyCheckpoint(checkpoint);
  await flushResearchWrites();
  // Restoration activates only through a checkpoint from THIS origin.
  payload.checkpoints.push(clone(checkpoint));
  const database = await db();
  let added = 0;
  try {
    const tx = database.transaction(STORES, "readwrite");
    try {
      for (const store of STORES) {
        if (store === "meta") continue;
        for (const value of payload[store]) {
          const previous = await tx.objectStore(store).get(value.id);
          if (previous && canonical(previous) !== canonical(value))
            fail(`备份ID冲突（${store}），未覆盖任何现有记录`);
          if (!previous) {
            await tx.objectStore(store).add(clone(value));
            added++;
          }
        }
      }
      await tx
        .objectStore("meta")
        .put({
          id: "active",
          value: payload.meta.find((m) => m.id === "active")?.value ?? null,
        });
      await tx
        .objectStore("audit")
        .add({
          id: createId(),
          createdAt: new Date().toISOString(),
          action: "backup_restored",
          catalogVersion: WEIGHT_VERSION,
          checkpointId: checkpoint.id,
        });
      await tx.done;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* already aborted */
      }
      await tx.done.catch(() => undefined);
      throw error;
    }
  } finally {
    database.close();
  }
  return { added };
}
