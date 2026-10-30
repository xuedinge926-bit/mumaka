import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  ChevronRight,
  Disc3,
  ImagePlus,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import {
  DIMENSIONS,
  LABELS,
  newAlbum,
  type Album,
  type AlbumUX,
  type Dimension,
  type Snapshot,
  type Track,
} from "./model/types";
import {
  calculatePrivate,
  PRIVATE_SOURCE_PRESET_OPTIONS,
  resolvePrivateSource,
} from "./model/privateReview";
import { genres } from "./model/engine";
import {
  listAlbums,
  saveAlbum,
  listSnapshots,
  savePrivateSnapshot,
  deleteAlbum,
  exportBackup,
  importBackup,
} from "./lib/storage";
import { exportJSON, exportCSV, exportSVG, exportPNG } from "./lib/exports";
import { blobToCoverDataURL, embedRemoteCover } from "./lib/images";
import {
  getAlbum,
  isSpotifyConfigured,
  searchAlbums,
  type SpotifyAlbumSummary,
} from "./lib/spotify";
import { createId } from "./lib/browserCrypto";
import { ScoreCard } from "./components/ScoreCard";
import { GenrePicker } from "./components/GenrePicker";
import { StarRating } from "./components/StarRating";
import { AlbumImportPanel } from "./components/AlbumImportPanel";
import { Workbench, type WorkbenchTab } from "./components/Workbench";
import { importedAlbum, type AlbumImport } from "./lib/albumImport";
import {
  readPreferences,
  writePreferences,
  type Preferences,
} from "./lib/preferences";
import { toScoreCardData } from "./lib/scoreCardData";
import provenance from "./data/provenance.json";

type Screen = "home" | "workbench" | "confirm" | "rating" | "card";
const SOURCE_LABELS = {
  new: "以新创作歌曲为主",
  cover: "以翻唱或已有作品为主",
  mixed: "原创与已有作品混合",
  rerecord: "以自己的旧作重录为主",
  unknown: "特殊情况 / 暂不确定",
};
const TRACK_SOURCE_LABELS = {
  new: "新创作",
  existing: "旧歌",
  rerecord: "旧作重录",
  unknown: "不确定",
};
const INITIAL_UX: AlbumUX = {
  market: "china",
  sourceKind: "new",
  cardRatio: "4:5",
  cardTheme: "paper",
};
function makeDraft() {
  return { ...newAlbum(), ux: { ...INITIAL_UX, ...readPreferences() } };
}
function errorText(error: unknown) {
  if (error instanceof DOMException && error.name === "QuotaExceededError")
    return "浏览器存储空间不足，请先导出备份，释放空间后重试。";
  if (error instanceof DOMException && error.name === "SecurityError")
    return "浏览器限制了本地存储，请允许此网站保存数据后重试。";
  return error instanceof Error ? error.message : String(error);
}
function timestamp(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
function duration(seconds: number) {
  return seconds > 0
    ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`
    : "";
}
function readDuration(text: string) {
  if (text.includes(":")) {
    const [m, s] = text.split(":").map(Number);
    return Number.isFinite(m) && Number.isFinite(s)
      ? Math.max(0, m * 60 + s)
      : 0;
  }
  const n = Number(text);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-shade" onClick={onClose}>
      <section
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label={`关闭${title}`}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

export default function App() {
  const [draft, setDraft] = useState<Album>(makeDraft);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [screen, setScreen] = useState<Screen>("home");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [settings, setSettings] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>("library");
  const [returnTo, setReturnTo] = useState<"home" | "workbench">("home");
  const [preferences, setPreferences] = useState<Preferences>(readPreferences);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SpotifyAlbumSummary[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [spotifyConnected, setSpotifyConnected] = useState<boolean | null>(
    null,
  );
  const [coverError, setCoverError] = useState("");
  const [moreRating, setMoreRating] = useState<Dimension | null>(null);
  const [naDimension, setNaDimension] = useState<Dimension | null>(null);
  const [naReason, setNaReason] = useState("");
  const [showAllTracks, setShowAllTracks] = useState(false);
  const [selectedTracks, setSelectedTracks] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkGenre, setBulkGenre] = useState("");
  const [viewRatio, setViewRatio] = useState<AlbumUX["cardRatio"]>();
  const [viewTheme, setViewTheme] = useState<AlbumUX["cardTheme"]>();
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const actionLock = useRef(false);
  const backupInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const searchAbort = useRef<AbortController | null>(null);
  const record = snapshot?.album ?? draft;
  const readonly = !!snapshot || record.status === "published";
  const calculation = snapshot?.calculation ?? calculatePrivate(record);
  const source = resolvePrivateSource(record);
  const market = record.ux?.market ?? "china";
  const ratio = viewRatio ?? record.ux?.cardRatio ?? "4:5";
  const theme = viewTheme ?? record.ux?.cardTheme ?? "paper";
  const scored = DIMENSIONS.filter(
    (d) => record.ratings[d].value !== null,
  ).length;
  const currentGenre = genres.find((g) => g.id === record.genreId);

  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const items = await listAlbums();
        if (!canceled) {
          setAlbums(items);
          setReady(true);
        }
      } catch (e) {
        if (!canceled) setError(`本地数据暂时无法读取：${errorText(e)}`);
      }
    })();
    return () => {
      canceled = true;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    isSpotifyConfigured(controller.signal)
      .then(setSpotifyConnected)
      .catch(() => {
        if (!controller.signal.aborted) setSpotifyConnected(false);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!ready || !dirty || readonly) return;
    const captured = draft;
    const timer = setTimeout(() => {
      queuedSave(captured).catch((e) => {
        if (latestDraft.current === captured) setSaving("保存失败");
        setError(`保存失败，请先从设置导出备份：${errorText(e)}`);
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [draft, dirty, ready, readonly]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  useEffect(() => {
    searchAbort.current?.abort();
    if (screen !== "home" || !query.trim() || spotifyConnected !== true) {
      setSearchResults([]);
      setSearchError("");
      setSearchBusy(false);
      return;
    }
    const controller = new AbortController();
    searchAbort.current = controller;
    const timer = setTimeout(async () => {
      setSearchBusy(true);
      setSearchError("");
      try {
        const found = await searchAlbums(query.trim(), controller.signal);
        if (!controller.signal.aborted) {
          setSearchResults(found);
          setSpotifyConnected(true);
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setSearchResults([]);
          const code = (e as { code?: string }).code;
          if (code === "SPOTIFY_NOT_CONFIGURED") setSpotifyConnected(false);
          else setSearchError(errorText(e));
        }
      } finally {
        if (!controller.signal.aborted) setSearchBusy(false);
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, screen, spotifyConnected]);

  function replaceDraft(next: Album) {
    latestDraft.current = next;
    setDraft(next);
  }
  function update(patch: Partial<Album>) {
    if (readonly || actionLock.current) return;
    const next = {
      ...latestDraft.current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    replaceDraft(next);
    setDirty(true);
    setSaving("正在保存");
  }
  function updateUX(patch: Partial<AlbumUX>) {
    update({
      ux: {
        market: "china",
        cardRatio: "4:5",
        cardTheme: "paper",
        ...record.ux,
        ...patch,
      },
    });
  }
  function updateRating(
    d: Dimension,
    value: Album["ratings"][Dimension]["value"],
    extra: Partial<Album["ratings"][Dimension]> = {},
  ) {
    update({
      ratings: {
        ...record.ratings,
        [d]: { ...record.ratings[d], value, ...extra },
      },
    });
  }
  function updateTrack(id: string, patch: Partial<Track>) {
    update({
      tracks: record.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    });
  }
  async function queuedSave(captured: Album) {
    const normalized = {
      ...captured,
      status:
        captured.status === "publish_eligible"
          ? ("research_candidate" as const)
          : captured.status,
    };
    const task = saveQueue.current
      .catch(() => undefined)
      .then(() => saveAlbum(normalized));
    saveQueue.current = task;
    await task;
    setAlbums(await listAlbums());
    if (latestDraft.current === captured) {
      replaceDraft(normalized);
      setDirty(false);
      setSaving("已保存");
    }
    try {
      localStorage.setItem("nmc-last-album", normalized.id);
    } catch {
      /* navigation preference only */
    }
    return normalized;
  }
  async function persist() {
    if (readonly) return;
    let captured = latestDraft.current;
    for (;;) {
      const saved = await queuedSave(captured);
      if (latestDraft.current === captured || latestDraft.current === saved)
        return;
      captured = latestDraft.current;
    }
  }
  async function action(fn: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }
  function resetView() {
    setSelectedTracks([]);
    setBulkOpen(false);
    setBulkGenre("");
    setShowAllTracks(false);
    setCoverError("");
    setViewRatio(undefined);
    setViewTheme(undefined);
  }
  async function goHome() {
    await action(async () => {
      if (dirty) await persist();
      setScreen("home");
      setReturnTo("home");
      setSnapshot(null);
      resetView();
    });
  }
  async function manual() {
    await action(async () => {
      if (dirty) await persist();
      replaceDraft(makeDraft());
      setSnapshot(null);
      setDirty(false);
      setSaving("");
      resetView();
      setScreen("confirm");
    });
  }
  async function openAlbum(
    album: Album,
    target: "confirm" | "rating" | "card" = "confirm",
  ) {
    await action(async () => {
      if (dirty) await persist();
      const latest =
        (await listAlbums()).find((a) => a.id === album.id) ?? album;
      let frozen: Snapshot | null = null;
      if (latest.status === "published") {
        frozen =
          (await listSnapshots(latest.id)).find(
            (s) =>
              s.kind === "published" &&
              s.album.revision === latest.revision &&
              s.album.updatedAt === latest.updatedAt,
          ) ?? null;
        if (!frozen)
          throw new Error(
            "这条历史记录缺少匹配快照，请使用完整备份恢复；不会按新规则重算。",
          );
      }
      replaceDraft(frozen?.album ?? latest);
      setSnapshot(frozen);
      setDirty(false);
      setSaving("已保存");
      resetView();
      setScreen(
        latest.status === "published"
          ? "card"
          : target === "card" && calculatePrivate(latest).total
            ? "card"
            : target === "rating"
              ? "rating"
              : "confirm",
      );
    });
  }
  async function openSnapshot(item: Snapshot) {
    await action(async () => {
      if (dirty) await persist();
      replaceDraft(item.album);
      setSnapshot(item);
      setDirty(false);
      setSaving("");
      setSettings(false);
      resetView();
      setScreen("card");
    });
  }
  async function copyRecord() {
    await action(async () => {
      if (dirty && !readonly) await persist();
      const now = new Date().toISOString();
      const next = {
        ...structuredClone(record),
        id: createId(),
        status: "draft" as const,
        revision: record.revision + 1,
        parentSnapshotId: snapshot?.id,
        createdAt: now,
        updatedAt: now,
      };
      await saveAlbum(next);
      replaceDraft(next);
      setSnapshot(null);
      setDirty(false);
      setAlbums(await listAlbums());
      setSaving("已保存");
      resetView();
      setScreen("confirm");
      setToast("已创建独立的新评分，历史版本保持不变。");
    });
  }
  async function selectSpotify(item: SpotifyAlbumSummary) {
    await action(async () => {
      if (dirty) await persist();
      const details = await getAlbum(item.id);
      const next = makeDraft();
      next.title = details.title;
      next.artist = details.artist;
      next.year = details.year;
      next.release =
        details.release ||
        (details.releaseType === "single"
          ? "Spotify 标注 Single；请确认作品类型"
          : "");
      next.kind = details.kind || "专辑";
      next.label = details.label || "";
      next.spotify = {
        id: details.id,
        url: details.url,
        coverUrl: details.coverUrl,
        releaseDate: details.releaseDate,
      };
      next.tracks = details.tracks.map((t) => ({
        id: createId(),
        title: t.title,
        duration: t.duration,
        genreId: "",
        lyricsSource: "",
        compositionSource: "",
        sourceEvidence: "",
      }));
      let imageError = "";
      if (details.coverUrl) {
        try {
          next.cover = await embedRemoteCover(details.coverUrl);
        } catch {
          imageError = "封面暂时无法载入导出文件，可上传本地封面。";
        }
      }
      await saveAlbum(next);
      replaceDraft(next);
      setAlbums(await listAlbums());
      setSnapshot(null);
      setDirty(false);
      setSaving("已保存");
      resetView();
      setCoverError(imageError);
      setScreen("confirm");
    });
  }
  async function uploadCover(file?: File) {
    if (!file || readonly) return;
    const target = record.id;
    await action(async () => {
      const cover = await blobToCoverDataURL(file);
      if (latestDraft.current.id !== target) return;
      const next = {
        ...latestDraft.current,
        cover,
        updatedAt: new Date().toISOString(),
      };
      replaceDraft(next);
      await queuedSave(next);
      setCoverError("");
    });
    if (coverInput.current) coverInput.current.value = "";
  }
  function addTrack() {
    update({
      tracks: [
        ...record.tracks,
        {
          id: createId(),
          title: "",
          duration: 0,
          genreId: "",
          lyricsSource: "",
          compositionSource: "",
          sourceEvidence: "",
          provenanceKind: "unknown",
        },
      ],
    });
  }
  async function nextRating() {
    if (!record.title.trim() || !record.artist.trim()) {
      setError("请先填写专辑名称和音乐人。");
      return;
    }
    if (record.blendMode === "single" && !record.genreId) {
      setError("请选择这张专辑的风格。");
      return;
    }
    if (
      record.blendMode !== "single" &&
      (!record.tracks.length || record.tracks.some((t) => !t.genreId))
    ) {
      setError("请为每首曲目选择风格，也可以批量指定。");
      return;
    }
    await action(async () => {
      if (dirty) await persist();
      setScreen("rating");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }
  async function generateCard() {
    if (!calculation.total) return;
    await action(async () => {
      if (!readonly) {
        await persist();
        await savePrivateSnapshot(latestDraft.current);
      }
      setScreen("card");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }
  async function imageExport(kind: "png" | "svg") {
    await action(async () => {
      if (!calculation.total) throw new Error("请先完成评分和必要的来源选择。");
      if (!readonly) {
        if (
          !latestDraft.current.cover &&
          latestDraft.current.spotify?.coverUrl
        ) {
          let cover: string;
          try {
            cover = await embedRemoteCover(
              latestDraft.current.spotify.coverUrl,
            );
          } catch {
            throw new Error("远程封面无法用于图片导出，请先返回上传本地封面。");
          }
          const next = {
            ...latestDraft.current,
            cover,
            updatedAt: new Date().toISOString(),
          };
          replaceDraft(next);
          await queuedSave(next);
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
        }
        await persist();
        await savePrivateSnapshot(latestDraft.current);
      } else if (!record.cover && record.spotify?.coverUrl) {
        throw new Error(
          "此历史版本未保存可导出的封面。请复制为新评分并上传本地封面，原版本保持不变。",
        );
      }
      const svg = document.getElementById(
        "score-card-svg",
      ) as SVGSVGElement | null;
      if (!svg) throw new Error("评分卡尚未就绪，请重试。");
      const filename = `新乐评主义-${record.artist || "音乐人"}-${record.title || "专辑"}.${kind}`;
      if (kind === "png") await exportPNG(svg, filename);
      else await exportSVG(svg, filename);
      setToast(`${kind.toUpperCase()} 已导出`);
    });
  }
  async function openSettings() {
    await action(async () => {
      if (dirty) await persist();
      setHistory(await listSnapshots());
      setSettings(true);
    });
  }
  async function backup() {
    await action(async () => {
      if (dirty) await persist();
      const text = await exportBackup();
      const url = URL.createObjectURL(
        new Blob([text], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `新乐评主义-备份-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setToast("备份已导出");
    });
  }
  async function restore(file?: File) {
    if (!file) return;
    await action(async () => {
      if (dirty) await persist();
      const count = await importBackup(await file.text());
      setAlbums(await listAlbums());
      setHistory(await listSnapshots());
      setToast(`已导入 ${count.albums} 条作品、${count.snapshots} 个版本。`);
    });
    if (backupInput.current) backupInput.current.value = "";
  }
  async function removeCurrent() {
    if (
      readonly ||
      !window.confirm(
        `删除「${record.title || "未命名专辑"}」当前草稿？历史版本仍然保留。`,
      )
    )
      return;
    await action(async () => {
      await persist();
      await deleteAlbum(record.id);
      setAlbums(await listAlbums());
      replaceDraft(makeDraft());
      setSnapshot(null);
      setDirty(false);
      setSettings(false);
      setScreen("home");
    });
  }
  function setPresentation(key: "cardRatio" | "cardTheme", value: string) {
    if (readonly) {
      if (key === "cardRatio") setViewRatio(value as AlbumUX["cardRatio"]);
      else setViewTheme(value as AlbumUX["cardTheme"]);
    } else updateUX({ [key]: value });
  }
  async function openWorkbench() {
    await action(async () => {
      if (dirty) await persist();
      setAlbums(await listAlbums());
      setHistory(await listSnapshots());
      setSettings(false);
      setSnapshot(null);
      setReturnTo("workbench");
      resetView();
      setScreen("workbench");
    });
  }
  function changePreferences(value: Preferences) {
    try {
      writePreferences(value);
      setPreferences(value);
      setToast("已保存新作品偏好");
    } catch {
      setError("偏好暂时无法保存，请检查浏览器存储权限。");
    }
  }
  function enableMultipleGenres() {
    update({
      blendMode: record.blendMode === "single" ? "equal" : record.blendMode,
      tracks: record.tracks.map((t) =>
        t.genreId || !record.genreId ? t : { ...t, genreId: record.genreId },
      ),
    });
  }
  async function copyLibraryAlbum(album: Album) {
    await action(async () => {
      if (dirty) await persist();
      const current =
        (await listAlbums()).find((a) => a.id === album.id) ?? album;
      const now = new Date().toISOString();
      const parent = (await listSnapshots(current.id))[0];
      const next: Album = {
        ...structuredClone(current),
        id: createId(),
        status: "draft",
        revision: current.revision + 1,
        parentSnapshotId: parent?.id,
        createdAt: now,
        updatedAt: now,
      };
      await saveAlbum(next);
      replaceDraft(next);
      setSnapshot(null);
      setDirty(false);
      setAlbums(await listAlbums());
      setSaving("已保存");
      resetView();
      setScreen("confirm");
      setToast("已创建独立副本，原记录保持不变。");
    });
  }
  async function deleteLibraryAlbum(album: Album) {
    if (
      album.status === "published" ||
      !window.confirm(
        `删除「${album.title || "未命名专辑"}」当前草稿？历史版本仍然保留。`,
      )
    )
      return;
    await action(async () => {
      if (dirty) await persist();
      await deleteAlbum(album.id);
      setAlbums(await listAlbums());
      if (latestDraft.current.id === album.id) {
        replaceDraft(makeDraft());
        setSnapshot(null);
        setDirty(false);
      }
      setToast("草稿已删除，历史版本仍然保留。");
    });
  }
  async function confirmImportedAlbum(value: AlbumImport) {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    try {
      if (dirty) await persist();
      const next = importedAlbum(value, { ...INITIAL_UX, ...preferences });
      await saveAlbum(next);
      replaceDraft(next);
      setAlbums(await listAlbums());
      setSnapshot(null);
      setDirty(false);
      setSaving("已保存");
      resetView();
      setImportOpen(false);
      setScreen("confirm");
    } catch (error) {
      throw new Error(errorText(error));
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }
  const localMatches = query.trim()
    ? albums
        .filter((a) =>
          `${a.title} ${a.artist}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
        )
        .slice(0, 8)
    : [];
  const baseRequirements =
    !record.title.trim() ||
    !record.artist.trim() ||
    (record.blendMode === "single" && !record.genreId);
  const missingTracks = record.tracks.filter((t) => !t.genreId).length;
  const sameFamily =
    record.tracks.length > 0 &&
    missingTracks === 0 &&
    new Set(
      record.tracks
        .map((track) => genres.find((g) => g.id === track.genreId)?.parentId)
        .filter(Boolean),
    ).size === 1;
  const shortError = !source.confirmed ? source.message : calculation.errors[0];

  return (
    <div className="nmc-app">
      <header className="site-header">
        <button
          className="wordmark"
          onClick={goHome}
          aria-label="MUMAKA / 木马卡，返回首页"
        >
          <strong>
            MUMAKA <span>/ 木马卡</span>
          </strong>
          <small>新乐评主义 / New Music Criticism</small>
        </button>
        <div className="header-right">
          {screen !== "home" && screen !== "workbench" && saving && (
            <span className="save-note">
              {saving === "正在保存" ? (
                <LoaderCircle size={12} className="spinning" />
              ) : (
                <Check size={12} />
              )}
              <span>{saving}</span>
            </span>
          )}
          <button
            className="icon-button settings-trigger"
            aria-label="设置"
            onClick={openSettings}
          >
            <Settings2 size={19} />
          </button>
        </div>
      </header>
      {error && (
        <div className="error-message" role="alert">
          <span>{error}</span>
          <button aria-label="关闭提示" onClick={() => setError("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {screen === "home" ? (
        <main className="home-page">
          <div className="album-search">
            <Search size={25} strokeWidth={1.5} />
            <input
              autoFocus
              aria-label="搜索专辑或音乐人"
              placeholder="搜索专辑或音乐人"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                className="icon-button"
                aria-label="清空搜索"
                onClick={() => setQuery("")}
              >
                <X size={18} />
              </button>
            )}
            {searchBusy && <LoaderCircle size={21} className="spinning" />}
          </div>
          <div className="home-actions">
            <button className="button primary" disabled={busy} onClick={manual}>
              快速评分
              <ArrowRight size={16} />
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={openWorkbench}
            >
              专业工作台
            </button>
          </div>
          <div className="search-helper">
            <button disabled={busy} onClick={() => setImportOpen(true)}>
              通过链接添加
            </button>
            <span aria-hidden="true">·</span>
            <button disabled={busy} onClick={manual}>
              手动添加专辑
              <Plus size={12} />
            </button>
            {spotifyConnected === false && <small>Spotify 搜索未配置</small>}
          </div>
          {query.trim() ? (
            <section className="search-results" aria-label="专辑搜索结果">
              {!!localMatches.length && (
                <div className="local-search-results">
                  <h2 className="local-results-heading">本机记录</h2>
                  {localMatches.map((album) => (
                    <button
                      key={album.id}
                      className="recent-album"
                      disabled={busy}
                      onClick={() => openAlbum(album)}
                    >
                      <div className="recent-cover">
                        {album.cover ? (
                          <img src={album.cover} alt="" />
                        ) : (
                          <Disc3 size={24} />
                        )}
                      </div>
                      <div>
                        <strong>{album.title || "未命名专辑"}</strong>
                        <span>
                          {album.artist}
                          {album.year ? ` · ${album.year}` : ""}
                        </span>
                      </div>
                      <ChevronRight size={17} />
                    </button>
                  ))}
                </div>
              )}
              {searchError && <p className="quiet-message">{searchError}</p>}
              {searchResults.map((item) => (
                <button
                  key={item.id}
                  className="album-result"
                  disabled={busy}
                  onClick={() => selectSpotify(item)}
                >
                  <div className="result-cover">
                    {item.coverUrl ? (
                      <img src={item.coverUrl} alt="" />
                    ) : (
                      <Disc3 size={24} />
                    )}
                  </div>
                  <div className="result-copy">
                    <strong>{item.title}</strong>
                    <span>{item.artist}</span>
                    <small>
                      {[item.year, item.release || item.releaseType]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </div>
                  <ArrowRight size={18} />
                </button>
              ))}
              {!searchBusy &&
                !searchResults.length &&
                spotifyConnected &&
                !searchError && (
                  <p className="quiet-message">
                    没有找到这张专辑。<button onClick={manual}>手动添加</button>
                  </p>
                )}
              {!!searchResults.length && (
                <div className="spotify-credit">搜索结果来自 Spotify</div>
              )}
            </section>
          ) : (
            <section className="recent-section">
              <div className="section-top">
                <h1>最近编辑</h1>
                {albums.length > 0 && (
                  <button className="quiet-link" onClick={openWorkbench}>
                    全部作品
                    <ArrowRight size={13} />
                  </button>
                )}
              </div>
              {!ready ? (
                <p className="quiet-message">正在读取…</p>
              ) : albums.length ? (
                <div className="recent-list">
                  {albums.slice(0, 8).map((album) => (
                    <button
                      key={album.id}
                      className="recent-album"
                      onClick={() => openAlbum(album)}
                      disabled={busy}
                    >
                      <div className="recent-cover">
                        {album.cover ? (
                          <img src={album.cover} alt="" />
                        ) : (
                          <Disc3 size={24} strokeWidth={1} />
                        )}
                      </div>
                      <div>
                        <strong>{album.title || "未命名专辑"}</strong>
                        <span>
                          {album.artist || "未填写音乐人"}
                          {album.year ? ` · ${album.year}` : ""}
                        </span>
                      </div>
                      <ChevronRight size={17} />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="quiet-message">暂无最近编辑</p>
              )}
            </section>
          )}
        </main>
      ) : screen === "workbench" ? (
        <Workbench
          albums={albums}
          snapshots={history}
          busy={busy}
          tab={workbenchTab}
          onTab={setWorkbenchTab}
          preferences={preferences}
          onPreferences={changePreferences}
          onOpen={openAlbum}
          onSnapshot={openSnapshot}
          onCopy={copyLibraryAlbum}
          onDelete={deleteLibraryAlbum}
          onManual={manual}
          onImport={() => setImportOpen(true)}
          onBackup={backup}
          onRestore={() => backupInput.current?.click()}
        />
      ) : (
        <main className={`flow-page ${screen === "card" ? "card-page" : ""}`}>
          <div className="flow-top">
            <button
              className="back-link"
              onClick={
                screen === "confirm"
                  ? returnTo === "workbench"
                    ? openWorkbench
                    : goHome
                  : () => setScreen(screen === "rating" ? "confirm" : "rating")
              }
            >
              <ArrowLeft size={16} />
              {screen === "confirm"
                ? returnTo === "workbench"
                  ? "返回作品库"
                  : "返回首页"
                : "返回修改"}
            </button>
            <nav className="step-nav" aria-label="评分步骤">
              {(["confirm", "rating", "card"] as Screen[]).map((step, i) => (
                <button
                  key={step}
                  disabled={
                    busy ||
                    (step === "card" && !calculation.total) ||
                    (step === "rating" &&
                      screen === "confirm" &&
                      baseRequirements)
                  }
                  aria-current={screen === step ? "step" : undefined}
                  onClick={() => {
                    if (step === "rating" && screen === "confirm") nextRating();
                    else if (step === "card" && screen === "rating")
                      generateCard();
                    else setScreen(step);
                  }}
                >
                  <span>{i + 1}</span>
                  {["确认专辑", "六维评分", "评分卡"][i]}
                </button>
              ))}
            </nav>
          </div>
          {readonly && (
            <div className="history-note">
              <span>历史版本 · 内容只读</span>
              <button onClick={copyRecord}>
                复制为新评分 <ArrowRight size={13} />
              </button>
            </div>
          )}
          {screen === "confirm" && (
            <>
              <fieldset disabled={readonly || busy} className="clean-fieldset">
                <section className="album-confirm">
                  <div className="album-cover-editor">
                    <button
                      className={
                        record.cover || record.spotify?.coverUrl
                          ? "has-image"
                          : ""
                      }
                      aria-label="上传专辑封面"
                      onClick={() => coverInput.current?.click()}
                    >
                      {record.cover || record.spotify?.coverUrl ? (
                        <img
                          src={record.cover || record.spotify?.coverUrl}
                          alt="专辑封面"
                        />
                      ) : (
                        <div>
                          <Disc3 size={47} strokeWidth={1} />
                          <span>添加封面</span>
                        </div>
                      )}
                      <span className="cover-edit-badge">
                        <ImagePlus size={15} />
                      </span>
                    </button>
                    <input
                      type="file"
                      ref={coverInput}
                      hidden
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => uploadCover(e.target.files?.[0])}
                    />
                    {coverError && <small>{coverError}</small>}
                  </div>
                  <div className="album-confirm-copy">
                    <input
                      aria-label="专辑名称"
                      className="editable-title"
                      placeholder="专辑名称"
                      value={record.title}
                      onChange={(e) => update({ title: e.target.value })}
                    />
                    <input
                      aria-label="音乐人"
                      className="editable-artist"
                      placeholder="音乐人 / 乐队"
                      value={record.artist}
                      onChange={(e) => update({ artist: e.target.value })}
                    />
                    <div className="album-meta-line">
                      <input
                        aria-label="发行年份"
                        placeholder="年份"
                        inputMode="numeric"
                        value={record.year}
                        onChange={(e) => update({ year: e.target.value })}
                      />
                      <span>·</span>
                      <select
                        aria-label="作品类型"
                        value={record.kind}
                        onChange={(e) =>
                          update({ kind: e.target.value as Album["kind"] })
                        }
                      >
                        <option value="专辑">Album</option>
                        <option value="EP">EP</option>
                      </select>
                    </div>
                    <input
                      aria-label="发行版本"
                      className="editable-release"
                      placeholder="发行版本（可选）"
                      value={record.release}
                      onChange={(e) => update({ release: e.target.value })}
                    />
                    {record.importSource && (
                      <div className="import-source-note">
                        <a
                          href={record.importSource.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          来自{" "}
                          {record.importSource.provider === "bandcamp"
                            ? "Bandcamp"
                            : "Apple Music"}{" "}
                          ↗
                        </a>
                        {record.importSource.referenceGenres.length > 0 && (
                          <details>
                            <summary>参考标签</summary>
                            <p>
                              {record.importSource.referenceGenres.join("、")} ·
                              请自行选择下方风格
                            </p>
                          </details>
                        )}
                      </div>
                    )}
                    {record.spotify && (
                      <a
                        className="spotify-attribution"
                        href={record.spotify.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        来自 Spotify ↗
                      </a>
                    )}
                  </div>
                </section>
                <details className="track-details">
                  <summary>
                    查看曲目（{record.tracks.length} 首）
                    <ChevronDown size={15} />
                  </summary>
                  <div className="track-edit-list">
                    {record.tracks.map((track, i) => (
                      <div className="track-edit-row" key={track.id}>
                        <span>{String(i + 1).padStart(2, "0")}</span>
                        <input
                          aria-label={`曲目 ${i + 1} 名称`}
                          placeholder="曲目名称"
                          value={track.title}
                          onChange={(e) =>
                            updateTrack(track.id, { title: e.target.value })
                          }
                        />
                        <input
                          aria-label={`曲目 ${i + 1} 时长`}
                          className="duration-input"
                          placeholder="时长"
                          defaultValue={duration(track.duration)}
                          key={`${track.id}-duration`}
                          onBlur={(e) =>
                            updateTrack(track.id, {
                              duration: readDuration(e.target.value),
                            })
                          }
                        />
                        <button
                          className="icon-button"
                          aria-label={`删除曲目 ${i + 1}`}
                          onClick={() =>
                            update({
                              tracks: record.tracks.filter(
                                (t) => t.id !== track.id,
                              ),
                            })
                          }
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                    <button className="quiet-link" onClick={addTrack}>
                      <Plus size={14} />
                      添加曲目
                    </button>
                  </div>
                </details>
                <section className="confirm-section">
                  <div className="section-label-row">
                    <h2>选择风格</h2>
                    <div
                      className="market-choice"
                      role="group"
                      aria-label="风格推荐地区"
                    >
                      <button
                        aria-pressed={market === "china"}
                        className={market === "china" ? "selected" : ""}
                        onClick={() => updateUX({ market: "china" })}
                      >
                        中国
                      </button>
                      <button
                        aria-pressed={market === "global"}
                        className={market === "global" ? "selected" : ""}
                        onClick={() => updateUX({ market: "global" })}
                      >
                        其他地区
                      </button>
                    </div>
                  </div>
                  <div
                    className="style-mode"
                    role="group"
                    aria-label="风格数量"
                  >
                    <button
                      aria-pressed={record.blendMode === "single"}
                      onClick={() => update({ blendMode: "single" })}
                    >
                      <i />
                      一种主风格
                    </button>
                    <button
                      aria-pressed={record.blendMode !== "single"}
                      onClick={enableMultipleGenres}
                    >
                      <i />
                      多种风格
                    </button>
                  </div>
                  {record.blendMode === "single" ? (
                    <GenrePicker
                      key={record.id}
                      value={record.genreId}
                      indexEntryId={record.chinaEntryId}
                      market={market}
                      disabled={readonly || busy}
                      onChange={(id, index = "") =>
                        update({ genreId: id, chinaEntryId: index })
                      }
                    />
                  ) : (
                    <div className="multi-genre">
                      <div className="multi-top">
                        <span>
                          {record.tracks.length} 首曲目
                          {missingTracks > 0
                            ? ` · ${missingTracks} 首尚未选择`
                            : ""}
                        </span>
                        <div className="multi-actions">
                          {record.genreId && (
                            <button
                              className="quiet-link"
                              onClick={() =>
                                update({
                                  tracks: record.tracks.map((t) =>
                                    t.genreId
                                      ? t
                                      : { ...t, genreId: record.genreId },
                                  ),
                                })
                              }
                            >
                              未分配曲目采用主风格
                            </button>
                          )}
                          <button
                            className="quiet-link"
                            onClick={() => setBulkOpen(!bulkOpen)}
                          >
                            批量指定风格
                          </button>
                        </div>
                      </div>
                      {bulkOpen && (
                        <div className="bulk-panel">
                          <label className="check-label">
                            <input
                              type="checkbox"
                              checked={
                                record.tracks.length > 0 &&
                                selectedTracks.length === record.tracks.length
                              }
                              onChange={(e) =>
                                setSelectedTracks(
                                  e.target.checked
                                    ? record.tracks.map((t) => t.id)
                                    : [],
                                )
                              }
                            />
                            全选曲目
                          </label>
                          <GenrePicker
                            label="批量曲目风格"
                            compact
                            key={`${record.id}-bulk`}
                            value={bulkGenre}
                            market={market}
                            onChange={(id) => setBulkGenre(id)}
                          />
                          <button
                            className="button small"
                            disabled={!bulkGenre || !selectedTracks.length}
                            onClick={() => {
                              update({
                                tracks: record.tracks.map((t) =>
                                  selectedTracks.includes(t.id)
                                    ? { ...t, genreId: bulkGenre }
                                    : t,
                                ),
                              });
                              setBulkOpen(false);
                              setSelectedTracks([]);
                            }}
                          >
                            应用到 {selectedTracks.length} 首
                          </button>
                        </div>
                      )}
                      {!record.tracks.length && (
                        <button className="quiet-link" onClick={addTrack}>
                          <Plus size={14} />
                          先添加曲目
                        </button>
                      )}
                      {record.tracks
                        .slice(0, showAllTracks ? undefined : 6)
                        .map((track, i) => (
                          <div className="track-genre-row" key={track.id}>
                            {bulkOpen && (
                              <input
                                type="checkbox"
                                aria-label={`选择曲目 ${i + 1}`}
                                checked={selectedTracks.includes(track.id)}
                                onChange={(e) =>
                                  setSelectedTracks(
                                    e.target.checked
                                      ? [...selectedTracks, track.id]
                                      : selectedTracks.filter(
                                          (id) => id !== track.id,
                                        ),
                                  )
                                }
                              />
                            )}
                            <span className="track-caption">
                              <small>{i + 1}</small>
                              {track.title || `曲目 ${i + 1}`}
                            </span>
                            <GenrePicker
                              label={`曲目 ${i + 1} 风格`}
                              compact
                              value={track.genreId}
                              market={market}
                              disabled={readonly || busy}
                              onChange={(id) =>
                                updateTrack(track.id, { genreId: id })
                              }
                            />
                          </div>
                        ))}
                      {record.tracks.length > 6 && (
                        <button
                          className="quiet-link show-tracks"
                          onClick={() => setShowAllTracks(!showAllTracks)}
                        >
                          {showAllTracks
                            ? "收起曲目"
                            : `展开全部 ${record.tracks.length} 首`}
                          <ChevronDown size={13} />
                        </button>
                      )}
                      <details className="more-options">
                        <summary>
                          更多选项
                          <ChevronDown size={13} />
                        </summary>
                        <label className="check-label">
                          <input
                            type="checkbox"
                            checked={record.blendMode === "duration"}
                            onChange={(e) =>
                              update({
                                blendMode: e.target.checked
                                  ? "duration"
                                  : "equal",
                              })
                            }
                          />
                          使用已核实的曲目时长（默认每首等份）
                        </label>
                      </details>
                      {sameFamily && (
                        <p className="subtle-hint">
                          这些曲目属于同一风格家族，通常可先用一种主风格。
                        </p>
                      )}
                    </div>
                  )}
                </section>
                <section className="confirm-section source-section">
                  <h2>这张专辑的歌曲主要是？</h2>
                  {!record.ux?.sourceKind && (
                    <p className="subtle-hint">
                      保留此前的来源选择；如需更改，请在此重新确认。
                    </p>
                  )}
                  <select
                    aria-label="歌曲主要来源"
                    value={record.ux?.sourceKind || ""}
                    onChange={(e) =>
                      updateUX({
                        sourceKind: e.target.value as AlbumUX["sourceKind"],
                        sourcePresetConfirmed: undefined,
                        sourceDoubleCount: undefined,
                      })
                    }
                  >
                    <option value="" disabled>
                      选择歌曲来源
                    </option>
                    {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  {record.ux?.sourceKind &&
                    ["cover", "mixed", "rerecord"].includes(
                      record.ux.sourceKind,
                    ) && (
                      <div className="source-followup">
                        <label>
                          这次评价应怎样侧重？
                          <select
                            aria-label="来源侧重方式"
                            value={record.ux.sourcePresetConfirmed || ""}
                            onChange={(e) =>
                              updateUX({
                                sourcePresetConfirmed: e.target.value,
                              })
                            }
                          >
                            <option value="" disabled>
                              请确认一种处理方式
                            </option>
                            {PRIVATE_SOURCE_PRESET_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          所选风格是否已经侧重旧歌的演绎？
                          <select
                            aria-label="来源是否重复计算"
                            value={record.ux.sourceDoubleCount || "unknown"}
                            onChange={(e) =>
                              updateUX({
                                sourceDoubleCount: e.target
                                  .value as AlbumUX["sourceDoubleCount"],
                              })
                            }
                          >
                            <option value="unknown">尚未确认</option>
                            <option value="clear">
                              没有，可以使用本次选择
                            </option>
                            <option value="included">
                              已经考虑，沿用风格原有侧重
                            </option>
                          </select>
                        </label>
                        {record.ux.sourceKind === "mixed" && (
                          <details className="mixed-sources">
                            <summary>
                              逐曲确认新旧来源（可选）
                              <ChevronDown size={13} />
                            </summary>
                            {record.tracks.map((track, i) => (
                              <label key={track.id}>
                                <span>{track.title || `曲目 ${i + 1}`}</span>
                                <select
                                  aria-label={`曲目 ${i + 1} 来源`}
                                  value={track.provenanceKind || "unknown"}
                                  onChange={(e) =>
                                    updateTrack(track.id, {
                                      provenanceKind: e.target
                                        .value as Track["provenanceKind"],
                                    })
                                  }
                                >
                                  {Object.entries(TRACK_SOURCE_LABELS).map(
                                    ([value, label]) => (
                                      <option key={value} value={value}>
                                        {label}
                                      </option>
                                    ),
                                  )}
                                </select>
                              </label>
                            ))}
                          </details>
                        )}
                      </div>
                    )}
                  {!source.confirmed && record.ux?.sourceKind !== "unknown" && (
                    <p className="subtle-hint">{source.message}</p>
                  )}
                </section>
              </fieldset>
              <div className="flow-footer">
                <span />
                <button
                  className="button primary"
                  disabled={busy || readonly}
                  onClick={nextRating}
                >
                  下一步：评分
                  <ArrowRight size={17} />
                </button>
              </div>
            </>
          )}
          {screen === "rating" && (
            <section className="rating-page">
              <div className="rating-album-heading">
                {record.cover ? (
                  <img src={record.cover} alt="" />
                ) : (
                  <Disc3 size={28} />
                )}
                <div>
                  <h1>{record.title || "未命名专辑"}</h1>
                  <p>
                    {record.artist}
                    {record.year ? ` · ${record.year}` : ""}
                  </p>
                </div>
              </div>
              <div className="rating-rows">
                {DIMENSIONS.map((d) => (
                  <div className="rating-row" key={d}>
                    <div className="dimension-name">
                      <h2>{LABELS[d]}</h2>
                    </div>
                    <StarRating
                      label={LABELS[d]}
                      value={record.ratings[d].value}
                      disabled={readonly || busy}
                      onChange={(value) => updateRating(d, value)}
                    />
                    <output aria-live="polite">
                      {typeof record.ratings[d].value === "number"
                        ? Number(record.ratings[d].value).toFixed(1)
                        : record.ratings[d].value === "na"
                          ? "N/A"
                          : "—"}
                    </output>
                    <div className="rating-more">
                      <button
                        className="icon-button"
                        aria-label={`${LABELS[d]}更多选项`}
                        disabled={readonly || busy}
                        onClick={() =>
                          setMoreRating(moreRating === d ? null : d)
                        }
                      >
                        <MoreHorizontal size={18} />
                      </button>
                      {moreRating === d && (
                        <div className="rating-menu">
                          <button
                            onClick={() => {
                              updateRating(d, null);
                              setMoreRating(null);
                            }}
                          >
                            清除评分
                          </button>
                          {(d === "lyrics" || d === "performance") && (
                            <button
                              onClick={() => {
                                setNaDimension(d);
                                setNaReason(record.ratings[d].naReason);
                                setMoreRating(null);
                              }}
                            >
                              {d === "lyrics"
                                ? "纯器乐 · 作词不适用"
                                : "特殊情形 · 表演不适用"}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="rating-bottom">
                <span>
                  {scored === 6 ? "六维已完成" : `${scored} / 6 维已评分`}
                </span>
                {!calculation.total && shortError && (
                  <button
                    className="rating-requirement"
                    onClick={() => setScreen("confirm")}
                  >
                    {shortError}
                    <ChevronRight size={13} />
                  </button>
                )}
              </div>
              <div className="flow-footer">
                <button
                  className="back-link"
                  onClick={() => setScreen("confirm")}
                >
                  <ArrowLeft size={15} />
                  修改风格
                </button>
                <button
                  className="button primary"
                  disabled={!calculation.total || busy}
                  onClick={generateCard}
                >
                  生成评分卡
                  <ArrowRight size={17} />
                </button>
              </div>
            </section>
          )}
          {screen === "card" && (
            <section className="card-workspace">
              <div className="card-tools">
                <div
                  className="ratio-options"
                  role="group"
                  aria-label="评分卡比例"
                >
                  {(["4:5", "3:4", "1:1"] as const).map((value) => (
                    <button
                      key={value}
                      aria-pressed={ratio === value}
                      onClick={() => setPresentation("cardRatio", value)}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <div
                  className="theme-options"
                  role="group"
                  aria-label="评分卡主题"
                >
                  <button
                    className="theme-swatch paper"
                    aria-label="米白主题"
                    aria-pressed={theme === "paper"}
                    onClick={() => setPresentation("cardTheme", "paper")}
                  />
                  <button
                    className="theme-swatch ink"
                    aria-label="深色主题"
                    aria-pressed={theme === "ink"}
                    onClick={() => setPresentation("cardTheme", "ink")}
                  />
                </div>
              </div>
              <div className="score-card-preview">
                <ScoreCard
                  data={toScoreCardData(
                    record,
                    calculation,
                    snapshot?.provenance,
                  )}
                  ratio={ratio}
                  theme={theme}
                />
              </div>
              <div className="summary-editor">
                <label htmlFor="album-summary">
                  写一句短评 <span>可选</span>
                </label>
                <textarea
                  id="album-summary"
                  disabled={readonly || busy}
                  rows={3}
                  aria-label="专辑短评"
                  placeholder="建议 120 字以内，不写也可以。"
                  value={record.summary}
                  onChange={(e) =>
                    update({
                      summary: Array.from(e.target.value)
                        .slice(0, 200)
                        .join(""),
                    })
                  }
                />
                <span className="character-count">
                  {Array.from(record.summary).length} / 200
                </span>
              </div>
              <div className="card-downloads">
                <button
                  className="button primary"
                  disabled={!calculation.total || busy}
                  onClick={() => imageExport("png")}
                >
                  {busy ? (
                    <LoaderCircle size={17} className="spinning" />
                  ) : (
                    <ArrowDownToLine size={17} />
                  )}
                  下载 PNG
                </button>
                <button
                  className="button secondary"
                  disabled={!calculation.total || busy}
                  onClick={() => imageExport("svg")}
                >
                  下载 SVG
                </button>
              </div>
              {readonly && (
                <button
                  className="quiet-link copy-from-card"
                  onClick={copyRecord}
                >
                  复制为新评分，继续修改
                  <ArrowRight size={14} />
                </button>
              )}
            </section>
          )}
        </main>
      )}
      <input
        type="file"
        ref={backupInput}
        hidden
        accept="application/json,.json"
        onChange={(e) => restore(e.target.files?.[0])}
      />
      {settings && (
        <Modal title="设置" onClose={() => setSettings(false)}>
          <section className="settings-section">
            <h3>备份与恢复</h3>
            <p>评分保存在当前浏览器。请定期备份。</p>
            <div className="settings-buttons">
              <button
                className="button secondary"
                onClick={backup}
                disabled={busy}
              >
                <ArrowDownToLine size={16} />
                导出全部备份
              </button>
              <button
                className="button secondary"
                onClick={() => backupInput.current?.click()}
                disabled={busy}
              >
                <ArrowUpFromLine size={16} />
                导入备份
              </button>
            </div>
          </section>
          <details className="settings-details">
            <summary>
              全部本机专辑
              <ChevronDown size={15} />
            </summary>
            {albums.length ? (
              albums.map((album) => (
                <button
                  className="history-item"
                  key={album.id}
                  onClick={() => {
                    setSettings(false);
                    openAlbum(album);
                  }}
                >
                  <span>
                    <b>{album.title || "未命名专辑"}</b>
                    <small>
                      {album.artist}
                      {album.year ? ` · ${album.year}` : ""}
                    </small>
                  </span>
                  <ChevronRight size={15} />
                </button>
              ))
            ) : (
              <p>暂无本机专辑</p>
            )}
          </details>
          <details className="settings-details">
            <summary>
              历史版本
              <ChevronDown size={15} />
            </summary>
            {history.length ? (
              history.map((item) => (
                <button
                  className="history-item"
                  key={item.id}
                  onClick={() => openSnapshot(item)}
                >
                  <span>
                    <b>{item.album.title || "未命名专辑"}</b>
                    <small>
                      {item.album.artist} · {timestamp(item.createdAt)}
                    </small>
                  </span>
                  <strong>{item.calculation.total || "—"}</strong>
                  <ChevronRight size={15} />
                </button>
              ))
            ) : (
              <p>暂无历史版本</p>
            )}
          </details>
          {screen !== "home" && screen !== "workbench" && (
            <details className="settings-details">
              <summary>
                当前评分文件
                <ChevronDown size={15} />
              </summary>
              <div className="settings-buttons">
                <button
                  className="button secondary"
                  onClick={() =>
                    exportJSON(record, calculation, snapshot?.provenance)
                  }
                >
                  导出 JSON
                </button>
                <button
                  className="button secondary"
                  onClick={() =>
                    exportCSV(record, calculation, snapshot?.provenance)
                  }
                >
                  导出 CSV
                </button>
              </div>
              {!readonly && (
                <button className="quiet-link danger" onClick={removeCurrent}>
                  <Trash2 size={14} />
                  删除当前草稿
                </button>
              )}
            </details>
          )}
          <details className="settings-details diagnostics">
            <summary>
              高级 / 诊断
              <ChevronDown size={15} />
            </summary>
            <p>
              模型 {provenance.modelVersion} · {genres.length} 项基础风格
            </p>
            <p>
              计算规则保留，私人评分无需发表审批。图片导出不会改变发表状态。
            </p>
            {screen !== "home" && screen !== "workbench" && (
              <>
                <p>
                  来源：{source.confirmed ? "已确认" : "尚未确认"}
                  {source.preset ? ` · ${source.preset}` : ""}
                </p>
                <p>当前风格：{currentGenre?.name || "未选择"}</p>
                <ul>
                  {calculation.errors.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </>
            )}
            {Object.entries(provenance.sourceFiles).map(([name, hash]) => (
              <div className="diagnostic-hash" key={name}>
                <span>{name}</span>
                <code>{hash}</code>
              </div>
            ))}
          </details>
        </Modal>
      )}
      {importOpen && (
        <Modal title="通过链接添加" onClose={() => setImportOpen(false)}>
          <AlbumImportPanel
            albums={albums}
            busy={busy}
            onConfirm={confirmImportedAlbum}
            onOpen={async (album) => {
              setImportOpen(false);
              await openAlbum(album);
            }}
            onManual={() => {
              setImportOpen(false);
              manual();
            }}
          />
        </Modal>
      )}
      {naDimension && (
        <Modal
          title={naDimension === "lyrics" ? "作词不适用" : "表演不适用"}
          onClose={() => setNaDimension(null)}
        >
          <div className="na-dialog">
            <p>
              {naDimension === "lyrics"
                ? "仅适用于整张发行没有可评价语言文本的纯器乐作品。个别器乐曲不适用此选项。"
                : "仅适用于确实没有可评价表演行为的极特殊情形。请明确记录具体情况。"}
            </p>
            {naDimension === "performance" && (
              <textarea
                aria-label="表演不适用的具体情况"
                placeholder="描述具体情况，无最低字数。"
                value={naReason}
                onChange={(e) => setNaReason(e.target.value)}
              />
            )}
            <button
              className="button primary"
              disabled={naDimension === "performance" && !naReason.trim()}
              onClick={() => {
                updateRating(naDimension, "na", {
                  naReason:
                    naDimension === "lyrics"
                      ? "用户明确确认：整张发行没有可评价语言文本。"
                      : naReason,
                  naApproved: naDimension === "performance",
                });
                setNaDimension(null);
              }}
            >
              确认不适用
            </button>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}
