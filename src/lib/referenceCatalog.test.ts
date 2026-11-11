import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { bundledCatalog, validateCatalog } from "../model/v040/catalog";
import { newDraft, six } from "../model/v040/types";
import { referenceAnchors } from "./referenceCatalog";
import { mainGenre, safeCover } from "./referencePresentation";
import { auditReferences } from "./referenceAudit";
import { manualSnapshot, manualSelectionIssues, upgradeReferenceCatalog } from "./referenceReview";
import legacy from "../data/v038";
import * as storage from "./v040Storage";
beforeEach(async () => {
  await storage.flushWrites();
  await new Promise<void>((resolve, reject) => {
    const r = indexedDB.deleteDatabase(storage.DATABASE);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
});
it("fills four independent 42-cell tables and retains the separate original R3 and manual sources", () => {
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
  expect(bundledCatalog.anchors.filter((a) => a.unassigned)).toHaveLength(0);
  expect(auditReferences(result).filter(i => i.severity === "error")).toEqual([]);
  expect(manualSelectionIssues(result)).toEqual([]);
  expect(manualSnapshot.rows.flatMap(r=>r.cells).filter(c=>c === null)).toHaveLength(19);
  expect(validateCatalog(legacy).anchors.filter(a=>a.unassigned)).toHaveLength(3);
  const c = structuredClone(bundledCatalog),
    a = c.anchors.find((a) => !a.manualLocked)!;
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
  expect(JSON.parse(backup).manualReferences[0]).toEqual(manualSnapshot);
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

it("migrates old working references without losing local decisions or changing either set of weights", () => {
  const old = validateCatalog(legacy);
  const edited = old.anchors.find(a => a.region === "global" && a.category === "song")!;
  edited.album = "本机人工选择";
  edited.approved = true;
  const conflict = old.anchors.find(a => a.id === "china-song-Lyrics-8")!;
  conflict.album = "升级前的本机编辑";
  const updated = upgradeReferenceCatalog(old);
  expect(updated.genres).toEqual(legacy.genres);
  expect(updated.families).toEqual(legacy.families);
  expect(updated.anchors.find(a => a.id === edited.id)!.album).toBe("本机人工选择");
  expect(updated.anchors.find(a => a.id === conflict.id)!.album).toBe("生命中的精灵");
  expect(updated.referenceConflicts?.find(a => a.id === conflict.id)?.previous.album).toBe("升级前的本机编辑");
});

it("keeps old approved local selections readable and recoverable when they predate the new metadata schema", async () => {
  const old = validateCatalog(legacy);
  const a = old.anchors.find(a=>a.region === "global" && a.category === "song")!;
  a.approved = true;
  a.artist = "旧版已核对的独立艺人";
  a.album = "旧版人工唱片";
  await storage.installCatalog(old);
  const saved = (await storage.state()).catalog.anchors.find(r=>r.id === a.id)!;
  expect(saved).toMatchObject(a);
  expect(saved.pending).toContain("本机编辑已保留");
  const backup = await storage.exportBackup();
  await storage.importBackup(backup);
  expect((await storage.state()).catalog.anchors.find(r=>r.id === a.id)).toEqual(saved);
});

it("protects manual selections and keeps their original transcription after an explicit local edit", async () => {
  const old = bundledCatalog.anchors.find(a=>a.id === "china-song-Lyrics-8")!;
  const candidate = {...old, feature:"人工核对后的新理由", displayStandard:"已核对标准"};
  await expect(storage.saveReferenceCandidate(candidate, old)).rejects.toThrow("受保护");
  const updated = await storage.saveReferenceCandidate(candidate, old, true);
  const saved = updated.anchors.find(a=>a.id === old.id)!;
  expect(saved.manualTitle).toBe("生命中的精灵");
  expect(saved.manualLocked).toBe(true);
  expect(updated.referenceConflicts?.[0].previous).toEqual(old);
  expect(manualSelectionIssues(updated.anchors)).toEqual([]);
  const original = JSON.parse(await storage.exportBackup()).manualReferences[0];
  const tampered = JSON.parse(await storage.exportBackup());
  tampered.manualReferences[0].rows[0].cells[0] = "自动填入的伪造底稿";
  await expect(storage.importBackup(JSON.stringify(tampered))).rejects.toThrow("人工底稿");
  expect(original).toEqual(manualSnapshot);
});

it("blocks repeated artists even for unapproved candidates and rejects a second repeated artist", async () => {
  const set = bundledCatalog.anchors.filter(a=>a.region === "global" && a.category === "song");
  const old = set.find(a=>a.dimension === "歌词" && a.stars === 2)!;
  const sameRow = set.find(a=>a.dimension === "歌词" && a.stars === 2.5)!;
  const duplicate = {...old, artist:sameRow.artist, primaryArtistId:sameRow.primaryArtistId, displayStandard:"完整的语言标准"};
  await expect(storage.saveReferenceCandidate(duplicate, old)).rejects.toThrow("同维七档");
  const firstArtist = set.find(a=>a.dimension === "作曲" && a.stars === 2)!;
  const c = await storage.saveReferenceCandidate({...old, artist:firstArtist.artist, primaryArtistId:firstArtist.primaryArtistId, displayStandard:"完整的语言标准"},old);
  const second = c.anchors.find(a=>a.id === sameRow.id)!;
  const secondArtist = set.find(a=>a.dimension === "作曲" && a.stars === 2.5)!;
  await expect(storage.saveReferenceCandidate({...second,artist:secondArtist.artist,primaryArtistId:secondArtist.primaryArtistId,displayStandard:"完整的语言标准"},second)).rejects.toThrow("最多只允许一位");
  expect((await storage.state()).catalog.anchors.find(a=>a.id === second.id)).toEqual(second);
});
