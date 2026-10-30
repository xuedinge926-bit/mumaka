import {
  newAlbum,
  type Album,
  type AlbumUX,
  type AlbumImportSource,
} from "../model/types";
import { createId } from "./browserCrypto";
import { blobToCoverDataURL } from "./images";

export interface AlbumMetadata {
  title: string;
  artist: string;
  year: string;
  releaseDate: string;
  releaseType: "album" | "ep" | "single" | null;
  coverUrl: string;
  coverDataUrl: string;
  label: string;
  tracks: { position: number; title: string; duration: number | null }[];
  referenceGenres: string[];
}
export interface AlbumImport {
  format: "mumaka-album-import";
  schemaVersion: 1;
  source: Pick<
    AlbumImportSource,
    "provider" | "url" | "metadataUrl" | "fetchedAt" | "adapter"
  >;
  album: AlbumMetadata;
  warnings: string[];
}
function fail(
  message = "元数据文件格式无法识别，请使用 MUMAKA 本地导入工具生成 JSON。",
): never {
  throw new Error(message);
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, max = 1000): string {
  if (typeof value !== "string" || value.length > max) fail();
  return value;
}
function https(value: unknown): string {
  const raw = text(value, 4096);
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password) fail();
    return raw;
  } catch {
    return fail("来源链接须为不含账号密码的 HTTPS 地址。");
  }
}

/** Accept metadata only. IDs, star ratings, weight vectors and status are never imported. */
export async function parseAlbumImport(value: unknown): Promise<AlbumImport> {
  if (
    !object(value) ||
    value.format !== "mumaka-album-import" ||
    value.schemaVersion !== 1 ||
    !object(value.source) ||
    !object(value.album)
  )
    fail();
  const source = value.source,
    album = value.album;
  if (
    !["apple-music", "bandcamp"].includes(String(source.provider)) ||
    typeof source.fetchedAt !== "string" ||
    !Number.isFinite(Date.parse(source.fetchedAt))
  )
    fail();
  if (
    album.releaseType !== null &&
    !["album", "ep", "single"].includes(String(album.releaseType))
  )
    fail();
  if (
    !Array.isArray(album.tracks) ||
    album.tracks.length > 1000 ||
    !Array.isArray(album.referenceGenres) ||
    album.referenceGenres.length > 40
  )
    fail();
  const seen = new Set<number>();
  const tracks = album.tracks
    .map((t) => {
      if (
        !object(t) ||
        typeof t.position !== "number" ||
        !Number.isInteger(t.position) ||
        t.position < 1 ||
        seen.has(t.position)
      )
        fail("曲目顺序格式错误，请重新生成元数据文件。");
      seen.add(t.position);
      if (
        t.duration !== null &&
        (typeof t.duration !== "number" ||
          !Number.isFinite(t.duration) ||
          t.duration < 0 ||
          t.duration > 86400)
      )
        fail("曲目时长格式错误。");
      return {
        position: t.position,
        title: text(t.title),
        duration: t.duration as number | null,
      };
    })
    .sort((a, b) => a.position - b.position);
  const encoded = text(album.coverDataUrl, 8 * 1024 * 1024);
  let coverDataUrl = "";
  if (encoded) {
    const match =
      /^data:(image\/(?:png|jpe?g|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(
        encoded,
      );
    if (!match) fail("封面必须是可本地保存的图片，请重新导入或手动上传。");
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
    } catch {
      return fail("封面图片内容无法读取。");
    }
    coverDataUrl = await blobToCoverDataURL(
      new Blob([bytes], { type: match[1] }),
    );
  }
  const warnings = Array.isArray(value.warnings)
    ? value.warnings.slice(0, 20).map((v) => text(v, 2000))
    : [];
  if (!https(source.url) || !https(source.metadataUrl)) fail('元数据缺少原始来源链接。');
  return {
    format: "mumaka-album-import",
    schemaVersion: 1,
    source: {
      provider: source.provider as AlbumImport["source"]["provider"],
      url: https(source.url),
      metadataUrl: https(source.metadataUrl),
      fetchedAt: source.fetchedAt,
      adapter: text(source.adapter, 100),
    },
    album: {
      title: text(album.title),
      artist: text(album.artist),
      year: text(album.year, 40),
      releaseDate: text(album.releaseDate, 80),
      releaseType: album.releaseType as AlbumMetadata["releaseType"],
      coverUrl: https(album.coverUrl),
      coverDataUrl,
      label: text(album.label),
      tracks,
      referenceGenres: album.referenceGenres.map((v) => text(v, 200)),
    },
    warnings,
  };
}

export async function readImportFile(file: File): Promise<AlbumImport> {
  if (file.size > 12 * 1024 * 1024)
    fail("元数据文件超过 12 MB，请检查文件是否正确。");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return fail("无法读取 JSON 文件。作品库备份请从“数据管理”导入。");
  }
  return parseAlbumImport(parsed);
}

export function importedAlbum(value: AlbumImport, ux: AlbumUX): Album {
  const { album: a, source } = value;
  const draft = newAlbum();
  return {
    ...draft,
    title: a.title,
    artist: a.artist,
    year: a.year,
    label: a.label,
    cover: a.coverDataUrl,
    kind: a.releaseType === "ep" ? "EP" : "专辑",
    release:
      a.releaseType === "single" ? "Single（来源标注；请确认作品类型）" : "",
    tracks: a.tracks.map((t) => ({
      id: createId(),
      title: t.title,
      duration: t.duration ?? 0,
      genreId: "",
      lyricsSource: "",
      compositionSource: "",
      sourceEvidence: "",
    })),
    ux: { ...ux },
    importSource: {
      ...source,
      releaseDate: a.releaseDate,
      releaseType: a.releaseType,
      referenceGenres: [...a.referenceGenres],
    },
  };
}
const normalized = (text: string) =>
  text.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/gu, " ");
const sourceUrl = (url: string) => {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/$/, "");
  } catch {
    return url;
  }
};
export function possibleDuplicates(
  value: AlbumImport,
  albums: Album[],
): Album[] {
  return albums.filter(
    (a) =>
      (a.importSource &&
        sourceUrl(a.importSource.url) === sourceUrl(value.source.url)) ||
      (!!value.album.title.trim() &&
        !!value.album.artist.trim() &&
        normalized(a.title) === normalized(value.album.title) &&
        normalized(a.artist) === normalized(value.album.artist)),
  );
}

export function isLocalPage(): boolean {
  return (
    typeof window !== "undefined" &&
    window.location.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(window.location.hostname)
  );
}
export async function localImporterAvailable(
  signal: AbortSignal,
): Promise<boolean> {
  if (!isLocalPage()) return false;
  try {
    const response = await fetch("/api/album-import/status", {
      signal,
      credentials: "omit",
    });
    if (!response.ok) return false;
    const result = await response.json();
    return result?.data?.available === true;
  } catch {
    return false;
  }
}
export async function fetchAlbumImport(
  url: string,
  signal: AbortSignal,
): Promise<AlbumImport> {
  if (!isLocalPage())
    fail("在线版请导入本地工具生成的元数据 JSON，或手动添加专辑。");
  let response: Response;
  try {
    response = await fetch("/api/album-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      credentials: "omit",
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    return fail(
      "本地导入服务没有响应，请检查是否使用 npm run local 启动，或继续手动添加。",
    );
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    return fail("本地导入服务暂不可用，可导入元数据 JSON 或手动添加。");
  }
  if (!response.ok)
    return fail(
      object(value) && typeof value.error === "string"
        ? value.error
        : "来源暂时无法读取，请手动添加。",
    );
  if (!object(value)) fail();
  return parseAlbumImport(value.data);
}
