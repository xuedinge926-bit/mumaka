import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { bundledCatalog } from "../model/v040/catalog";
import { newDraft, six } from "../model/v040/types";
import { referenceAnchors } from "./referenceCatalog";
import { mainGenre, safeCover } from "./referencePresentation";
import * as storage from "./v040Storage";
beforeEach(async () => {
  await storage.flushWrites();
  await new Promise<void>((resolve, reject) => {
    const r = indexedDB.deleteDatabase(storage.DATABASE);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
});
it("fills only R3 gaps, keeps 168 unique identities and preserves all reviewed material", () => {
  const result = referenceAnchors(bundledCatalog);
  expect(result).toHaveLength(168);
  expect(new Set(result.map((a) => a.id)).size).toBe(168);
  expect(
    result.every(
      (a) =>
        a.album &&
        a.artist &&
        /^\d{4}$/.test(a.year) &&
        mainGenre(a) !== "风格待确认",
    ),
  ).toBe(true);
  expect(bundledCatalog.anchors.filter((a) => a.unassigned)).toHaveLength(3);
  const c = structuredClone(bundledCatalog),
    a = c.anchors.find((a) => a.unassigned)!;
  a.approved = true;
  a.album = "用户已审定";
  expect(referenceAnchors(c).find((r) => r.id === a.id)!.album).toBe(
    "用户已审定",
  );
});
it("reference edits survive complete backup, preserve weights, freeze old scores and reject stale writes", async () => {
  const d = newDraft();
  d.title = "技术样本";
  d.artist = "测试";
  d.modes.song.genreId = "genre:dance-pop";
  d.modes.song.ratingsTicks = six(() => 8);
  await storage.saveDraft(d);
  const snapshot = await storage.saveSnapshot(d, bundledCatalog);
  const old = bundledCatalog.anchors.find(
    (a) => a.id === "china-song-Production-5",
  )!;
  const candidate = {
    ...referenceAnchors(bundledCatalog).find((a) => a.id === old.id)!,
    displayStandard: "声音的各部分稳定服务作品。",
    mainGenre: "流行",
  };
  const c = await storage.saveReferenceCandidate(candidate, old);
  expect(c.genres).toEqual(bundledCatalog.genres);
  expect(c.families).toEqual(bundledCatalog.families);
  expect((await storage.verifySnapshot(snapshot)).calculation.total).toBe(
    "8.00",
  );
  await expect(storage.saveReferenceCandidate(candidate, old)).rejects.toThrow(
    "另一处修改",
  );
  const backup = await storage.exportBackup();
  expect(
    JSON.parse(backup).catalog.anchors.find(
      (a: { id: string }) => a.id === old.id,
    ).album,
  ).toBe("慢慢懂");
  await storage.importBackup(backup);
  const saved = (await storage.state()).catalog.anchors.find(
    (a) => a.id === old.id,
  )!;
  await expect(
    storage.saveReferenceCandidate({ ...saved, approved: true }, saved),
  ).rejects.toThrow("审定需要");
  await expect(
    storage.saveReferenceCandidate(
      { ...saved, coverUrl: "javascript:alert(1)" },
      saved,
    ),
  ).rejects.toThrow("HTTPS");
});
it("rejects overwriting an approved cell without explicit unlock", async () => {
  const c = structuredClone(bundledCatalog),
    old = c.anchors[0];
  Object.assign(old, {
    approved: true,
    artist: "仅供校验的唯一艺人",
    album: "仅供校验",
    mainGenre: "流行",
    displayStandard: "校验标准",
  });
  await storage.installCatalog(c);
  await expect(
    storage.saveReferenceCandidate({ ...old, feature: "changed" }, old),
  ).rejects.toThrow("受保护");
});
it("cover fallback accepts only public HTTPS URLs without embedded credentials", () => {
  expect(safeCover("javascript:alert(1)")).toBeUndefined();
  expect(safeCover("https://user:pass@example.com/a.png")).toBeUndefined();
  expect(safeCover("https://example.com/a.png")).toBe(
    "https://example.com/a.png",
  );
});
