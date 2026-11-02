import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import * as storage from "./v040Storage";
import {
  exportBackup as exportLegacyBackup,
  saveAlbum,
  savePrivateSnapshot,
} from "./storage";
import { newAlbum } from "../model/types";
import { bundledCatalog } from "../model/v040/catalog";
import { newDraft, six } from "../model/v040/types";
import { cardData, evaluationCSV } from "./v040Exports";

const rated = () => {
  const d = newDraft();
  d.title = "冻结与往返测试";
  d.artist = "测试";
  d.modes.song.genreId = "genre:dance-pop";
  d.modes.song.ratingsTicks = six(() => 8);
  return d;
};
beforeEach(async () => {
  await storage.flushWrites();
  for (const name of [storage.DATABASE, "nmc-workbench-v1"])
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
});
describe("V0.40 independent local storage", () => {
  it("checkpoints but never edits the old database or historical calculations", async () => {
    const old = newAlbum();
    old.title = "旧模型";
    old.ratings.sound.value = 4;
    await saveAlbum(old);
    await savePrivateSnapshot(old);
    const before = JSON.parse(await exportLegacyBackup());
    await storage.initialize();
    await storage.saveDraft(rated());
    const after = JSON.parse(await exportLegacyBackup());
    expect(after.albums).toEqual(before.albums);
    expect(after.snapshots).toEqual(before.snapshots);
    const checkpoint = JSON.parse((await storage.legacyCheckpoint())!);
    expect(checkpoint.albums).toEqual(before.albums);
    expect(checkpoint.snapshots).toEqual(before.snapshots);
  });
  it("serializes drafts and rejects stale or same-revision conflicting saves", async () => {
    const d = rated();
    await storage.saveDraft(d);
    const next = structuredClone(d);
    next.revision++;
    next.modes.instrumental.ratingsTicks[0] = 5;
    await storage.saveDraft(next);
    await expect(storage.saveDraft(d)).rejects.toThrow(/更新版本/);
    const collision = structuredClone(next);
    collision.title = "冲突";
    await expect(storage.saveDraft(collision)).rejects.toThrow();
    expect(
      (await storage.state()).drafts[0].modes.instrumental.ratingsTicks[0],
    ).toBe(5);
  });
  it("freezes provenance, weights, both mode drafts and score even after catalog changes", async () => {
    const d = rated();
    await storage.initialize();
    await storage.saveDraft(d);
    const snapshot = await storage.saveSnapshot(d, bundledCatalog);
    const replacement = structuredClone(bundledCatalog);
    replacement.sourceVersion = "v0.38-test-only";
    replacement.genres[0].profiles.song.weightsTicks![0]++;
    replacement.genres[0].profiles.song.weightsTicks![1]--;
    await storage.installCatalog(replacement);
    const saved = (await storage.state()).snapshots[0];
    expect(saved.calculation.total).toBe("8.00");
    expect(saved.catalogSnapshot.genres[0].profiles.song.weightsTicks).toEqual([
      38, 46, 32, 24, 30, 30,
    ]);
    await storage.verifySnapshot(saved);
    expect(cardData(saved.draft, replacement, saved).score.total).toBe("8.00");
    await expect(storage.saveSnapshot(d, bundledCatalog)).rejects.toThrow(
      /权重已变更/,
    );
    await storage.deleteDraft(d.id);
    expect((await storage.state()).snapshots[0].id).toBe(snapshot.id);
  });
  it("round-trips a full backup idempotently and rejects conflicts atomically", async () => {
    const d = rated();
    await storage.saveDraft(d);
    await storage.saveSnapshot(d, bundledCatalog);
    const json = await storage.exportBackup();
    expect((await storage.importBackup(json)).added).toBe(0);
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(storage.DATABASE);
      req.onsuccess = () => resolve();
    });
    expect((await storage.importBackup(json)).added).toBe(2);
    expect((await storage.state()).snapshots[0].calculation.total).toBe("8.00");
    const bad = JSON.parse(json);
    bad.drafts.unshift({ ...d, id: "would-be-added" });
    bad.drafts[1].title = "conflict";
    await expect(storage.importBackup(JSON.stringify(bad))).rejects.toThrow(
      /冲突/,
    );
    expect((await storage.state()).drafts).toHaveLength(1);
  });
  it("does not accept tampered snapshots or automatically approve candidates", async () => {
    const d = rated();
    await storage.saveDraft(d);
    await expect(storage.saveSnapshot(d, bundledCatalog, true)).rejects.toThrow(
      /禁止自动批准/,
    );
    const s = await storage.saveSnapshot(d, bundledCatalog);
    s.calculation.total = "9.99";
    await expect(storage.verifySnapshot(s)).rejects.toThrow(/完整性/);
  });
  it("exports a mixed CSV with two sets of four dimensions and vision/context once", () => {
    const d = rated();
    d.mixed.enabled = true;
    const csv = evaluationCSV(d, bundledCatalog);
    expect(csv.split("\r\n")).toHaveLength(11);
    expect(csv.match(/专辑一次/g)).toHaveLength(2);
  });
});
