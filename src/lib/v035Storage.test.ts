import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { openDB } from "idb";
import { DIMENSIONS as OLD_DIMENSIONS, newAlbum } from "../model/types";
import { calculate } from "../model/engine";
import { saveAlbum, saveSnapshot, exportBackup } from "./storage";
import {
  createLegacyCheckpoint,
  installResearchCatalog,
  deactivateResearchCatalog,
  researchState,
  saveResearchDraft,
  saveResearchSnapshot,
  exportResearchBackup,
  importResearchBackup,
  validateResearchSnapshot,
  canonical,
  SHADOW_DB,
  flushResearchWrites,
} from "./v035Storage";
import {
  newResearchDraft,
  DIMENSIONS,
  WEIGHT_VERSION,
  type Vector,
} from "../model/v035/types";
import { families, genres } from "../model/v035/catalog";
import { sha256Hex } from "./browserCrypto";
import { snapshotJSON, snapshotCSV, researchCardData } from "./v035Exports";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ScoreCard } from "../components/ScoreCard";

// Only synthetic databases in an isolated fake-indexeddb worker; never a user's browser backup.
beforeEach(async () => {
  await flushResearchWrites().catch(() => undefined);
  for (const name of ["nmc-workbench-v1", SHADOW_DB])
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.deleteDatabase(name);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
});
const content = async () => {
  const d = JSON.parse(await exportBackup());
  return canonical({ albums: d.albums, snapshots: d.snapshots });
};
function complete() {
  const d = newResearchDraft();
  d.title = "明确虚构的数据库验收样本";
  d.artist = "技术测试";
  d.coreGenreId = "genre:post-punk";
  d.firstMode = "expression";
  d.ratings = Object.fromEntries(DIMENSIONS.map((k) => [k, 8])) as Vector;
  return d;
}
async function enable() {
  const c = await createLegacyCheckpoint();
  await installResearchCatalog(c);
  return c;
}
function publishedLegacy() {
  const a = newAlbum();
  a.title = "仅用于自动测试的V019已发表记录";
  a.artist = "技术测试";
  a.genreId = "genre:pop-general";
  a.fullListenConfirmed = true;
  a.releaseIdentityVerified = true;
  a.sourceReviewed = true;
  a.noDoubleCount = true;
  a.cultureNote = "定性理解不增加权重";
  a.genreEvidence = "稳定流行歌曲结构";
  a.genreExclusions = "未出现摇滚合奏结构";
  a.reviewer = "技术审核者";
  a.tracks = [
    {
      id: crypto.randomUUID(),
      title: "技术样本曲目",
      duration: 180,
      genreId: a.genreId,
      lyricsSource: "新作",
      compositionSource: "新作",
      sourceEvidence: "虚构技术用例",
    },
  ];
  for (const k of OLD_DIMENSIONS)
    Object.assign(a.ratings[k], {
      value: 4,
      evidence: "维度依据",
      counterEvidence: "局部反例",
      rationale: "独立理由",
    });
  return a;
}
describe("V0.35 shadow transactions, immutable records and rollback", () => {
  it("backs up this origin and imports 34/565/522 in a separate schema with zero approvals", async () => {
    const c = await enable();
    expect(c.origin).toBe("test-only://fake-indexeddb");
    const db = await openDB(SHADOW_DB);
    expect(await db.count("families")).toBe(34);
    expect(await db.count("genres")).toBe(565);
    expect(await db.count("profiles")).toBe(522);
    expect(
      (await db.getAll("profiles")).every(
        (p) => p.reviewStatus === "research_candidate",
      ),
    ).toBe(true);
    expect(await db.get("checkpoints", c.id)).toEqual(c);
    db.close();
    const old = await openDB("nmc-workbench-v1");
    expect(old.version).toBe(1);
    expect(Array.from(old.objectStoreNames)).toEqual(["albums", "snapshots"]);
    old.close();
  }, 30_000);
  it("preserves every field, N/A and published legacy display through import, use and rollback", async () => {
    const na = newAlbum();
    na.title = "技术N/A样本";
    na.genreId = "genre:pop-general";
    na.ratings.lyrics.value = "na";
    na.ratings.lyrics.naReason = "合成测试的无歌词记录";
    await saveAlbum(na);
    await saveSnapshot(na, calculate(na));
    const published = publishedLegacy();
    await saveSnapshot(published, calculate(published), "published");
    const before = await content();
    await enable();
    const d = complete();
    await saveResearchDraft(d);
    await saveResearchSnapshot(d);
    await deactivateResearchCatalog();
    expect(await content()).toBe(before);
    expect((await researchState()).active).toBe(false);
    expect((await researchState()).revisions).toHaveLength(1);
  }, 30_000);
  it("rejects stale or damaged checkpoints before writing the catalog", async () => {
    const c = await createLegacyCheckpoint();
    await saveAlbum(newAlbum());
    await expect(installResearchCatalog(c)).rejects.toThrow("发生变化");
    expect((await researchState()).catalog).toBeUndefined();
    const fresh = await createLegacyCheckpoint();
    fresh.json += " ";
    await expect(installResearchCatalog(fresh)).rejects.toThrow("校验失败");
  }, 30_000);
  it("aborts every staged write when a later stored catalog record conflicts", async () => {
    await enable();
    await deactivateResearchCatalog();
    const db = await openDB(SHADOW_DB);
    const missingId = `${WEIGHT_VERSION}:${families[0].id}`;
    await db.delete("families", missingId);
    const lastId = `${WEIGHT_VERSION}:${genres.at(-1)!.id}`,
      damaged = await db.get("genres", lastId);
    damaged.record.reason = "故意注入冲突";
    await db.put("genres", damaged);
    db.close();
    const before = JSON.parse(await exportResearchBackup()).payload;
    await expect(
      installResearchCatalog(await createLegacyCheckpoint()),
    ).rejects.toThrow("冲突");
    const after = JSON.parse(await exportResearchBackup()).payload;
    expect(after).toEqual(before);
    const check = await openDB(SHADOW_DB);
    expect(await check.get("families", missingId)).toBeUndefined();
    check.close();
  }, 30_000);
  it("rejects saving while inactive, and allows reactivation without deleting old revisions", async () => {
    await expect(saveResearchDraft(complete())).rejects.toThrow("尚未启用");
    await enable();
    const s = await saveResearchSnapshot(complete());
    await deactivateResearchCatalog();
    await expect(saveResearchSnapshot(complete())).rejects.toThrow("未激活");
    await enable();
    expect((await researchState()).revisions[0]).toEqual(s);
  }, 30_000);
  it("recalculates new snapshots internally, appends revisions and isolates subsequent object edits", async () => {
    await enable();
    const d = complete();
    await saveResearchDraft(d);
    const first = await saveResearchSnapshot(d);
    d.ratings.first = 10;
    d.evidence.first.support = "新理由";
    await saveResearchDraft(d);
    const second = await saveResearchSnapshot(d);
    first.album.title = "外部篡改返回值";
    const saved = (await researchState()).revisions;
    expect(first.id).not.toBe(second.id);
    expect(saved).toHaveLength(2);
    expect(saved.find((x) => x.id === first.id)!.display).toBe("8.00");
    expect(saved.find((x) => x.id === first.id)!.album.title).not.toBe(
      "外部篡改返回值",
    );
    await validateResearchSnapshot(second);
  }, 30_000);
  it("refuses incomplete or midpoint-unreviewed snapshots and retains an empty draft", async () => {
    await enable();
    const d = complete();
    d.ratings.first = null;
    await saveResearchDraft(d);
    await expect(saveResearchSnapshot(d)).rejects.toThrow("六维尚未");
    expect((await researchState()).drafts[0].ratings.first).toBeNull();
  }, 30_000);
  it("exports self-contained immutable JSON/CSV and dynamically labeled research cards", async () => {
    await enable();
    const d = complete();
    d.title = "=2+2";
    const s = await saveResearchSnapshot(d);
    expect(JSON.parse(snapshotJSON(s)).snapshot).toEqual(s);
    const csv = snapshotCSV(s);
    expect(csv).toContain("'=2+2");
    expect(csv).toContain(s.integrityHash);
    expect(csv).toContain("不可变快照JSON");
    expect(csv).toContain("Expression");
    const svg = renderToStaticMarkup(
      createElement(ScoreCard, {
        data: researchCardData(s.album, s),
        ratio: "1:1",
      }),
    );
    expect(svg).toContain('viewBox="0 0 1080 1080"');
    expect(svg).toContain("研究评分");
    expect(svg).toContain("Expression");
    expect(svg).toContain("genre:post-punk");
    expect(svg).not.toContain("私人评分");
  }, 30_000);
  it("restores a backup without overriding IDs and rejects tampered totals even with a new outer digest", async () => {
    const c = await enable(),
      d = complete();
    await saveResearchDraft(d);
    await saveResearchSnapshot(d);
    const json = await exportResearchBackup();
    await importResearchBackup(json, c);
    expect((await researchState()).drafts).toHaveLength(1);
    expect((await researchState()).revisions).toHaveLength(1);
    const bad = JSON.parse(json);
    bad.payload.revisions[0].scoreCents += 1;
    bad.sha256 = await sha256Hex(canonical(bad.payload));
    await expect(importResearchBackup(JSON.stringify(bad), c)).rejects.toThrow(
      "快照内容校验",
    );
    expect((await researchState()).revisions[0].scoreCents).toBe(800);
  }, 30_000);
  it("rolls back all newly added records when a restore reaches a later draft conflict", async () => {
    const c = await enable(),
      d = complete();
    await saveResearchDraft(d);
    await saveResearchSnapshot(d);
    const backup = JSON.parse(await exportResearchBackup()),
      fresh = complete();
    backup.payload.drafts[0].title = "与现有ID冲突";
    backup.payload.drafts.unshift(fresh);
    backup.sha256 = await sha256Hex(canonical(backup.payload));
    const before = JSON.parse(await exportResearchBackup()).payload;
    await expect(
      importResearchBackup(JSON.stringify(backup), c),
    ).rejects.toThrow("冲突");
    expect(JSON.parse(await exportResearchBackup()).payload).toEqual(before);
  }, 30_000);
  it("rejects checkpoint count claims and altered embedded source records independently of the outer digest", async () => {
    const c = await createLegacyCheckpoint();
    await expect(installResearchCatalog({ ...c, albums: 99 })).rejects.toThrow(
      "数量",
    );
    await installResearchCatalog(c);
    const s = await saveResearchSnapshot(complete());
    s.family.review_status = "approved";
    s.integrityHash = await sha256Hex(canonical({ ...s, integrityHash: "" }));
    await expect(validateResearchSnapshot(s)).rejects.toThrow("冻结来源");
  }, 30_000);
});
