import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import {
  importedAlbum,
  parseAlbumImport,
  possibleDuplicates,
  type AlbumImport,
} from "./albumImport";
import { newAlbum } from "../model/types";
import { exportBackup, importBackup, listAlbums, saveAlbum } from "./storage";

const fixture = (): AlbumImport => ({
  format: "mumaka-album-import",
  schemaVersion: 1,
  source: {
    provider: "bandcamp",
    url: "https://fixture.bandcamp.com/album/test",
    metadataUrl: "https://fixture.bandcamp.com/album/test",
    fetchedAt: "2026-10-30T00:00:00Z",
    adapter: "bandcamp-public-structured-v1",
  },
  album: {
    title: "Fixture",
    artist: "Test artist",
    year: "2024",
    releaseDate: "2024-03-01",
    releaseType: "ep",
    coverUrl: "",
    coverDataUrl: "",
    label: "",
    referenceGenres: ["external-tag"],
    tracks: [
      { position: 2, title: "Second", duration: null },
      { position: 1, title: "First", duration: 123.5 },
    ],
  },
  warnings: [],
});
beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("nmc-workbench-v1");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});

describe("album metadata boundary", () => {
  it("creates a new draft without copying IDs, stars, styles or source classifications from external data", async () => {
    const raw = {
      ...fixture(),
      id: "existing-id",
      ratings: { lyrics: 5 },
      genreId: "genre:pop-general",
    };
    const value = await parseAlbumImport(raw);
    const album = importedAlbum(value, { market: "china", sourceKind: "new" });
    expect(album.id).not.toBe("existing-id");
    expect(album.kind).toBe("EP");
    expect(album.genreId).toBe("");
    expect(album.ratings.lyrics.value).toBeNull();
    expect(album.tracks.map((t) => t.title)).toEqual(["First", "Second"]);
    expect(album.tracks[1].duration).toBe(0);
    expect(album.importSource?.referenceGenres).toEqual(["external-tag"]);
    expect(album.sourceDelta).toEqual([0, 0, 0, 0, 0, 0]);
  });
  it("keeps a Single label explicit and never guesses it is an EP", async () => {
    const raw = fixture();
    raw.album.releaseType = "single";
    const album = importedAlbum(await parseAlbumImport(raw), {
      market: "china",
    });
    expect(album.kind).not.toBe("EP");
    expect(album.importSource?.releaseType).toBe("single");
    expect(album.release).toContain("Single");
  });
  it("rejects script images, malformed order, invalid time and executable links", async () => {
    for (const mutate of [
      (v: AlbumImport) =>
        (v.album.coverDataUrl = "data:image/svg+xml;base64,ABC"),
      (v: AlbumImport) => (v.album.tracks[0].position = 1),
      (v: AlbumImport) => (v.album.tracks[0].duration = -1),
      (v: AlbumImport) => (v.source.url = "javascript:alert(1)"),
      (v: AlbumImport) => (v.source.fetchedAt = "not-a-date"),
    ]) {
      const raw = fixture();
      mutate(raw);
      await expect(parseAlbumImport(raw)).rejects.toThrow();
    }
  });
  it("validates and embeds actual raster bytes for offline reuse", async () => {
    const raw = fixture();
    raw.album.coverDataUrl =
      "data:image/png;base64," +
      readFileSync(
        new URL("../../tests/fixtures/cover.png", import.meta.url),
      ).toString("base64");
    expect((await parseAlbumImport(raw)).album.coverDataUrl).toBe(
      raw.album.coverDataUrl,
    );
    raw.album.coverDataUrl =
      "data:image/png;base64," + Buffer.from("not-a-png").toString("base64");
    await expect(parseAlbumImport(raw)).rejects.toThrow("内容");
  });
  it("warns on same source or normalized title and artist, including old records without provenance", () => {
    const one = { ...newAlbum(), title: "fixture", artist: "Test  artist" };
    const two = {
      ...newAlbum(),
      title: "another",
      importSource: {
        ...fixture().source,
        releaseDate: "",
        releaseType: null,
        referenceGenres: [],
      },
    };
    expect(possibleDuplicates(fixture(), [one, two])).toHaveLength(2);
  });
  it("roundtrips additive provenance in the existing database and backup without overwriting an existing score", async () => {
    const old = {
      ...newAlbum(),
      title: "old review",
      genreId: "genre:pop-general",
    };
    old.ratings.lyrics.value = 4;
    await saveAlbum(old);
    const value = await parseAlbumImport(fixture());
    value.album.title = "User-confirmed title";
    const draft = importedAlbum(value, { market: "china", sourceKind: "new" });
    await saveAlbum(draft);
    const before = await listAlbums();
    expect(before.find((a) => a.id === old.id)).toEqual(old);
    const backup = await exportBackup();
    await importBackup(backup);
    expect(await listAlbums()).toEqual(before);
    expect(
      JSON.parse(backup).albums.find((a: { id: string }) => a.id === draft.id)
        .importSource.url,
    ).toBe(value.source.url);
    expect(draft.title).toBe("User-confirmed title");
  });
  it.each(["netease", "qq-music"] as const)(
    "keeps %s source, original share URL and user-confirmed data in the same backup format",
    async (provider) => {
      const raw = fixture();
      raw.source.provider = provider;
      raw.source.originalUrl =
        provider === "netease"
          ? "https://163cn.tv/bjQO3xkl"
          : "https://c6.y.qq.com/base/fcgi-bin/u?__=2zNumVIuq73g";
      raw.source.url =
        provider === "netease"
          ? "https://music.163.com/album?id=123"
          : "https://y.qq.com/n/ryqq/albumDetail/QQFIXTUREALBUM01";
      raw.source.metadataUrl = raw.source.url;
      const album = importedAlbum(await parseAlbumImport(raw), {
        market: "china",
        sourceKind: "new",
      });
      await saveAlbum(album);
      const text = await exportBackup();
      await importBackup(text);
      expect((await listAlbums())[0].importSource?.provider).toBe(provider);
      expect((await listAlbums())[0].importSource?.originalUrl).toBe(
        raw.source.originalUrl,
      );
      expect((await listAlbums())[0].genreId).toBe("");
      raw.source.originalUrl = "javascript:alert(1)";
      await expect(parseAlbumImport(raw)).rejects.toThrow();
    },
  );
});
