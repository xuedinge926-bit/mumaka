import { openDB, type DBSchema } from "idb";
import { createId, sha256Hex } from "./browserCrypto";
import { exportBackup as exportLegacyBackup } from "./storage";
import { bundledCatalog, validateCatalog } from "../model/v040/catalog";
import { calculate, canSnapshot, validateDraft } from "../model/v040/engine";
import {
  CATEGORIES,
  MODEL_VERSION,
  DEFINITIONS_VERSION,
  type Catalog,
  type Draft,
  type Snapshot,
} from "../model/v040/types";

export const DATABASE = "mumaka-v040";
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
const hash = (value: unknown) => sha256Hex(canonical(value));
interface Database extends DBSchema {
  drafts: { key: string; value: Draft };
  snapshots: { key: string; value: Snapshot; indexes: { albumId: string } };
  meta: { key: string; value: { id: string; value: unknown } };
}
const db = () =>
  openDB<Database>(DATABASE, 1, {
    upgrade(database) {
      database.createObjectStore("drafts", { keyPath: "id" });
      database
        .createObjectStore("snapshots", { keyPath: "id" })
        .createIndex("albumId", "albumId");
      database.createObjectStore("meta", { keyPath: "id" });
    },
  });
let queue = Promise.resolve();
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
export const flushWrites = () => queue;

/** Checkpoint is local data in the NEW database; the legacy schema stays at v1. */
export async function initialize() {
  return enqueue(async () => {
    const database = await db();
    try {
      if (!(await database.get("meta", "legacy-checkpoint"))) {
        const json = await exportLegacyBackup();
        await database.put("meta", {
          id: "legacy-checkpoint",
          value: {
            json,
            sha256: await sha256Hex(json),
            createdAt: new Date().toISOString(),
          },
        });
      }
    } finally {
      database.close();
    }
  });
}
export async function state() {
  await flushWrites();
  const database = await db();
  try {
    const [drafts, snapshots, imported] = await Promise.all([
      database.getAll("drafts"),
      database.getAll("snapshots"),
      database.get("meta", "catalog"),
    ]);
    return {
      drafts: drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      snapshots: snapshots.sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
      catalog: imported ? validateCatalog(imported.value) : bundledCatalog,
    };
  } finally {
    database.close();
  }
}
export function saveDraft(draft: Draft) {
  validateDraft(draft);
  const copy = structuredClone(draft);
  return enqueue(async () => {
    const database = await db();
    try {
      const previous = await database.get("drafts", copy.id);
      if (
        previous &&
        (copy.revision < previous.revision ||
          (copy.revision === previous.revision &&
            canonical(copy) !== canonical(previous)))
      )
        throw new Error("检测到更新版本，未用旧草稿覆盖。");
      await database.put("drafts", copy);
    } finally {
      database.close();
    }
  });
}
export function deleteDraft(id: string) {
  return enqueue(async () => {
    const database = await db();
    try {
      await database.delete("drafts", id);
    } finally {
      database.close();
    }
  });
}
export async function installCatalog(input: unknown) {
  const catalog = validateCatalog(input);
  const bundledIds = bundledCatalog.genres
    .map((g) => g.id)
    .sort()
    .join("\n");
  if (
    catalog.genres
      .map((g) => g.id)
      .sort()
      .join("\n") !== bundledIds
  )
    throw new Error("新版包不能替换或重编号565个稳定ID");
  return enqueue(async () => {
    const database = await db();
    try {
      // Replacing the working catalog changes no existing frozen result.
      await database.put("meta", { id: "catalog", value: catalog });
    } finally {
      database.close();
    }
  });
}
export async function saveSnapshot(
  draft: Draft,
  catalog: Catalog,
  publish = false,
): Promise<Snapshot> {
  validateDraft(draft);
  // Read the installed catalog rather than accepting a caller's claimed approval.
  const current = (await state()).catalog;
  if (canonical(current) !== canonical(catalog))
    throw new Error("工作权重已变更，请刷新后再保存快照");
  const calculation = calculate(draft, current);
  if (!canSnapshot(draft, calculation))
    throw new Error("请补齐专辑信息、评分及条件适用依据，再保存快照。");
  if (publish && !calculation.publishable)
    throw new Error(
      "尚未具备已审定权重、整碟试听、完整证据及人工审核；禁止自动批准。",
    );
  const categories = draft.mixed.enabled ? [...CATEGORIES] : [draft.category];
  const snapshot: Snapshot = {
    schemaVersion: 2,
    id: createId(),
    albumId: draft.id,
    createdAt: new Date().toISOString(),
    modelVersion: MODEL_VERSION,
    dimensionDefinitionsVersion: DEFINITIONS_VERSION,
    weightVersion: current.weightVersion,
    category: draft.category,
    status: publish ? "published" : "research_only",
    draft: structuredClone(draft),
    calculation: structuredClone(calculation),
    catalogSnapshot: {
      sourceVersion: current.sourceVersion,
      weightVersion: current.weightVersion,
      sourceSha256: current.sourceSha256,
      genres: structuredClone(
        current.genres.filter((g) =>
          categories.some((c) => draft.modes[c].genreId === g.id),
        ),
      ),
    },
    ...(publish
      ? {
          approval: {
            reviewer: draft.reviewer,
            approvedAt: new Date().toISOString(),
            action: "explicit_manual_publication" as const,
          },
        }
      : {}),
    integrityHash: "",
  };
  snapshot.integrityHash = await hash({ ...snapshot, integrityHash: "" });
  return enqueue(async () => {
    const database = await db();
    try {
      const tx = database.transaction(["snapshots", "drafts"], "readwrite");
      await tx.objectStore("snapshots").add(structuredClone(snapshot));
      const previous = await tx.objectStore("drafts").get(draft.id);
      if (!previous || previous.revision <= draft.revision)
        await tx.objectStore("drafts").put(structuredClone(draft));
      await tx.done;
      return structuredClone(snapshot);
    } finally {
      database.close();
    }
  });
}
export async function verifySnapshot(value: unknown): Promise<Snapshot> {
  const s = value as Snapshot;
  if (
    !s ||
    s.schemaVersion !== 2 ||
    !s.id ||
    s.albumId !== s.draft?.id ||
    s.modelVersion !== MODEL_VERSION ||
    s.dimensionDefinitionsVersion !== DEFINITIONS_VERSION ||
    s.category !== s.draft.category ||
    !["research_only", "published"].includes(s.status) ||
    !Number.isFinite(Date.parse(s.createdAt)) ||
    !s.catalogSnapshot?.weightVersion ||
    s.weightVersion !== s.catalogSnapshot.weightVersion ||
    !/^[a-f0-9]{64}$/.test(s.catalogSnapshot.sourceSha256)
  )
    throw new Error("评分快照的身份或来源无效");
  validateDraft(s.draft);
  if ((await hash({ ...s, integrityHash: "" })) !== s.integrityHash)
    throw new Error("评分快照完整性校验失败");
  const computed = calculate(s.draft, s.catalogSnapshot);
  if (
    !canSnapshot(s.draft, computed) ||
    canonical(computed) !== canonical(s.calculation)
  )
    throw new Error("冻结权重与冻结分数不一致");
  if (
    s.status === "published" &&
    (!computed.publishable ||
      s.approval?.action !== "explicit_manual_publication" ||
      s.approval.reviewer !== s.draft.reviewer ||
      !Number.isFinite(Date.parse(s.approval.approvedAt)))
  )
    throw new Error("正式发布快照缺少人工批准");
  return structuredClone(s);
}
export async function exportBackup(): Promise<string> {
  const current = await state(),
    database = await db();
  try {
    return JSON.stringify(
      {
        format: "mumaka-v040-backup",
        schemaVersion: 2,
        exportedAt: new Date().toISOString(),
        drafts: current.drafts,
        snapshots: current.snapshots,
        catalog: current.catalog,
        legacyCheckpoint:
          (await database.get("meta", "legacy-checkpoint"))?.value ?? null,
      },
      null,
      2,
    );
  } finally {
    database.close();
  }
}
export async function importBackup(json: string) {
  if (json.length > 40_000_000) throw new Error("备份文件超过40MB，请分批处理");
  let p = JSON.parse(json);
  if (p.format === "mumaka-v040-evaluation" && p.schemaVersion === 2) {
    validateDraft(p.draft);
    const snapshots: Snapshot[] = [];
    if (p.calculation?.complete) {
      const s: Snapshot = {
        schemaVersion: 2,
        id: `import-${await hash(p)}`,
        albumId: p.draft.id,
        createdAt: p.draft.updatedAt,
        modelVersion: MODEL_VERSION,
        dimensionDefinitionsVersion: DEFINITIONS_VERSION,
        weightVersion: p.catalogSnapshot?.weightVersion,
        category: p.draft.category,
        status: "research_only",
        draft: p.draft,
        calculation: p.calculation,
        catalogSnapshot: p.catalogSnapshot,
        integrityHash: "",
      };
      s.integrityHash = await hash({ ...s, integrityHash: "" });
      await verifySnapshot(s);
      snapshots.push(s);
    }
    p = {
      format: "mumaka-v040-backup",
      schemaVersion: 2,
      drafts: [p.draft],
      snapshots,
      catalog: (await state()).catalog,
    };
  } else if (p.schemaVersion === 2 && p.integrityHash && p.catalogSnapshot) {
    const s = await verifySnapshot(p);
    p = {
      format: "mumaka-v040-backup",
      schemaVersion: 2,
      drafts: [],
      snapshots: [s],
      catalog: (await state()).catalog,
    };
  }
  if (
    p.format !== "mumaka-v040-backup" ||
    p.schemaVersion !== 2 ||
    !Array.isArray(p.drafts) ||
    !Array.isArray(p.snapshots)
  )
    throw new Error("需要V0.40完整JSON备份；旧版备份请使用旧版恢复入口");
  const catalog = validateCatalog(p.catalog);
  if (
    catalog.genres
      .map((g) => g.id)
      .sort()
      .join() !==
    bundledCatalog.genres
      .map((g) => g.id)
      .sort()
      .join()
  )
    throw new Error("稳定风格ID不一致");
  p.drafts.forEach(validateDraft);
  await Promise.all(p.snapshots.map(verifySnapshot));
  for (const store of ["drafts", "snapshots"] as const)
    if (
      new Set(p[store].map((r: { id: string }) => r.id)).size !==
      p[store].length
    )
      throw new Error("备份含重复ID");
  if (p.legacyCheckpoint !== null && p.legacyCheckpoint !== undefined) {
    const c = p.legacyCheckpoint;
    if (typeof c.json !== "string" || (await sha256Hex(c.json)) !== c.sha256)
      throw new Error("旧库保护副本校验失败");
  }
  return enqueue(async () => {
    const database = await db();
    let added = 0;
    try {
      const tx = database.transaction(
        ["drafts", "snapshots", "meta"],
        "readwrite",
      );
      try {
        for (const store of ["drafts", "snapshots"] as const)
          for (const item of p[store]) {
            const previous = await tx.objectStore(store).get(item.id);
            if (previous && canonical(previous) !== canonical(item))
              throw new Error("备份ID冲突：未覆盖任何现有作品或历史版本");
            if (!previous) {
              await tx.objectStore(store).add(structuredClone(item));
              added++;
            }
          }
        await tx.objectStore("meta").put({ id: "catalog", value: catalog });
        // A foreign backup never replaces this browser's pre-upgrade checkpoint.
        if (
          !(await tx.objectStore("meta").get("legacy-checkpoint")) &&
          p.legacyCheckpoint
        )
          await tx
            .objectStore("meta")
            .add({ id: "legacy-checkpoint", value: p.legacyCheckpoint });
        await tx.done;
      } catch (e) {
        try {
          tx.abort();
        } catch {
          /* already aborted */
        }
        await tx.done.catch(() => undefined);
        throw e;
      }
    } finally {
      database.close();
    }
    return { added };
  });
}
export async function legacyCheckpoint(): Promise<string | null> {
  await flushWrites();
  const database = await db();
  try {
    return (await database.get("meta", "legacy-checkpoint"))?.value
      ? (
          (await database.get("meta", "legacy-checkpoint"))!.value as {
            json: string;
          }
        ).json
      : null;
  } finally {
    database.close();
  }
}
