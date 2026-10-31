import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Disc3, Plus } from "lucide-react";
import type { Album, Snapshot } from "../model/types";
import { newAlbum } from "../model/types";
import {
  DIMENSIONS,
  MODEL_VERSION,
  WEIGHT_VERSION,
  fromLegacy,
  labels,
  newResearchDraft,
  type ResearchDraft,
  type ResearchSnapshot,
  type Dimension,
} from "../model/v035/types";
import { calculateResearch } from "../model/v035/engine";
import { catalogCounts, genreById, searchGenres } from "../model/v035/catalog";
import {
  createLegacyCheckpoint,
  installResearchCatalog,
  deactivateResearchCatalog,
  researchState,
  saveResearchDraft,
  saveResearchSnapshot,
  flushResearchWrites,
  exportResearchBackup,
  importResearchBackup,
} from "../lib/v035Storage";
import { downloadBlob, exportPNG, exportSVG } from "../lib/exports";
import {
  researchCardData,
  snapshotJSON,
  snapshotCSV,
} from "../lib/v035Exports";
import { blobToCoverDataURL } from "../lib/images";
import { createId } from "../lib/browserCrypto";
import { importedAlbum, type AlbumImport } from "../lib/albumImport";
import { ResearchGenrePicker } from "./ResearchGenrePicker";
import { ResearchFirstUnits } from "./ResearchFirstUnits";
import { StarRating } from "./StarRating";
import { ScoreCard } from "./ScoreCard";
import { AlbumImportPanel } from "./AlbumImportPanel";
import { libraryCalculation } from "./Workbench";
import "./research.css";

type RecordRoute = { kind: "draft" | "revision"; id: string };
interface Props {
  record?: RecordRoute;
  legacyAlbums: Album[];
  legacySnapshots: Snapshot[];
  onNavigate: (record?: RecordRoute) => void;
  onOpenLegacy: (album: Album) => Promise<void>;
}
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const filename = (s: string) =>
  s.replace(/[\\/:*?"<>|]/gu, "_") || "未命名专辑";
const date = (s: string) =>
  new Date(s).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
const download = (text: string, name: string, type = "application/json") =>
  downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), name);
const emptyState = {
  active: false,
  catalog: undefined,
  drafts: [] as ResearchDraft[],
  revisions: [] as ResearchSnapshot[],
};

export function ResearchWorkspace({
  record,
  legacyAlbums,
  legacySnapshots,
  onNavigate,
  onOpenLegacy,
}: Props) {
  const [state, setState] =
    useState<Awaited<ReturnType<typeof researchState>>>(emptyState);
  const [draft, setDraft] = useState<ResearchDraft | null>(null);
  const [snapshot, setSnapshot] = useState<ResearchSnapshot | null>(null);
  const [tab, setTab] = useState<"library" | "catalog" | "data">("library");
  const [editorTab, setEditorTab] = useState<"edit" | "card">("edit");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [legacyChoice, setLegacyChoice] = useState("");
  const [auxQuery, setAuxQuery] = useState("");
  const [viewRatio, setViewRatio] = useState<ResearchDraft["cardRatio"]>();
  const [viewTheme, setViewTheme] = useState<ResearchDraft["cardTheme"]>();
  const latest = useRef<ResearchDraft | null>(null),
    lock = useRef(false),
    card = useRef<HTMLDivElement>(null);
  const restoreInput = useRef<HTMLInputElement>(null),
    coverInput = useRef<HTMLInputElement>(null);
  const readonly = !!snapshot || !state.active;
  const calculation = draft ? calculateResearch(draft) : null;
  const naming = labels(draft?.firstMode ?? "lyrics");
  const cardData = draft ? researchCardData(draft, snapshot) : null;
  async function refresh() {
    const next = await researchState();
    setState(next);
    return next;
  }
  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError("");
    setImportOpen(false);
    setEditorTab("edit");
    setViewRatio(undefined);
    setViewTheme(undefined);
    (async () => {
      try {
        await flushResearchWrites();
        const next = await researchState();
        if (canceled) return;
        setState(next);
        const frozen =
          record?.kind === "revision"
            ? (next.revisions.find((s) => s.id === record.id) ?? null)
            : null;
        const active =
          record?.kind === "draft"
            ? (next.drafts.find((d) => d.id === record.id) ?? null)
            : (frozen?.album ?? null);
        if (record && !active)
          throw new Error("未找到这条研究记录，请返回研究作品库。");
        setSnapshot(frozen);
        setDraft(active);
        latest.current = active;
        setStatus(frozen ? "不可变研究快照" : active ? "已保存" : "");
      } catch (e) {
        if (!canceled) setError(message(e));
      } finally {
        if (!canceled) setLoading(false);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [record?.kind, record?.id]);
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(message(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function update(patch: Partial<ResearchDraft>) {
    if (!latest.current || readonly || lock.current) return;
    const next = {
      ...latest.current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    latest.current = next;
    setDraft(next);
    setStatus("正在保存…");
    try {
      saveResearchDraft(next).then(
        () => {
          if (latest.current === next) setStatus("已保存");
        },
        (e) => {
          setStatus("保存失败");
          setError(message(e));
        },
      );
    } catch (e) {
      setStatus("保存失败");
      setError(message(e));
    }
  }
  function rating(key: Dimension, value: number | null) {
    if (!latest.current) return;
    update({
      ratings: {
        ...latest.current.ratings,
        [key]: value === null ? null : value * 2,
      },
      ...(key === "first" ? { midpointReviewed: false } : {}),
    });
  }
  function evidence(
    key: Dimension,
    patch: Partial<ResearchDraft["evidence"][Dimension]>,
  ) {
    if (latest.current)
      update({
        evidence: {
          ...latest.current.evidence,
          [key]: { ...latest.current.evidence[key], ...patch },
        },
      });
  }
  async function create(next = newResearchDraft()) {
    await saveResearchDraft(next);
    await refresh();
    onNavigate({ kind: "draft", id: next.id });
  }
  async function enable() {
    const checkpoint = await createLegacyCheckpoint();
    download(
      checkpoint.json,
      `MUMAKA-当前地址旧库-${checkpoint.createdAt.slice(0, 10)}.json`,
    );
    await installResearchCatalog(checkpoint);
    await refresh();
    setStatus(
      `当前地址旧库已备份：${checkpoint.albums} 个作品，${checkpoint.snapshots} 个快照`,
    );
  }
  async function freeze() {
    const current = latest.current;
    if (!current) return;
    const frozen = await saveResearchSnapshot(current);
    await refresh();
    onNavigate({ kind: "revision", id: frozen.id });
  }
  async function newRevision() {
    if (!snapshot) return;
    const now = new Date().toISOString();
    await create({
      ...structuredClone(snapshot.album),
      id: createId(),
      status: "draft",
      createdAt: now,
      updatedAt: now,
      revision: snapshot.album.revision + 1,
      parent: {
        modelVersion: snapshot.modelVersion,
        albumId: snapshot.albumId,
        snapshotId: snapshot.id,
        score: snapshot.display,
      },
    });
  }
  async function importAlbum(value: AlbumImport) {
    // Reuse the existing metadata adapter without writing a legacy album.
    const next = fromLegacy(
      importedAlbum(value, {
        market: "china",
        cardRatio: "4:5",
        cardTheme: "paper",
      }),
    );
    delete next.parent;
    await create(next);
    setImportOpen(false);
  }
  async function restore(file?: File) {
    if (!file) return;
    await run(async () => {
      const checkpoint = await createLegacyCheckpoint();
      download(checkpoint.json, "MUMAKA-恢复前当前地址旧库.json");
      const result = await importResearchBackup(await file.text(), checkpoint);
      await refresh();
      setStatus(`研究备份已恢复，新增${result.added}条记录；未覆盖已有ID。`);
    });
    if (restoreInput.current) restoreInput.current.value = "";
  }
  function exportImage(kind: "png" | "svg") {
    void run(async () => {
      const svg = card.current?.querySelector("svg");
      if (!snapshot || !svg) throw new Error("请先保存并打开不可变研究快照");
      if (kind === "png")
        await exportPNG(svg, `${filename(snapshot.album.title)}-研究评分.png`);
      else
        await exportSVG(svg, `${filename(snapshot.album.title)}-研究评分.svg`);
    });
  }
  const duplicateAlbums = [
    ...legacyAlbums,
    ...state.drafts.map((d) => ({
      ...newAlbum(),
      id: d.id,
      title: d.title,
      artist: d.artist,
      year: d.year,
      release: d.release,
      cover: d.cover,
      kind: d.kind,
      ...(d.importSource ? { importSource: d.importSource } : {}),
    })),
  ];
  return (
    <main className="workspace-page research-workspace">
      <div className="workbench-heading">
        <div>
          <p>MUMAKA / 木马卡 · 新乐评主义</p>
          <h1>V0.35 研究评分</h1>
        </div>
        <span className="research-badge">研究候选 · 未审定</span>
      </div>
      <p className="research-intro">
        六个维度，一个主风格。用明确的作品证据记录判断；保留每一次历史评分。
      </p>
      <div className="research-topbar">
        <nav aria-label="研究工作区">
          <button
            aria-current={!record && tab === "library" ? "page" : undefined}
            onClick={() => {
              setTab("library");
              onNavigate();
            }}
          >
            研究作品与记录
          </button>
          <button
            aria-current={!record && tab === "catalog" ? "page" : undefined}
            onClick={() => {
              setTab("catalog");
              onNavigate();
            }}
          >
            34 / 565 风格目录
          </button>
          <button
            aria-current={!record && tab === "data" ? "page" : undefined}
            onClick={() => {
              setTab("data");
              onNavigate();
            }}
          >
            备份与回滚
          </button>
        </nav>
        <small role="status">{status}</small>
      </div>
      {error && (
        <div className="error-message" role="alert">
          {error}
          <button onClick={() => setError("")} aria-label="关闭研究提示">
            ×
          </button>
        </div>
      )}
      {loading ? (
        <p role="status">正在读取研究工作区…</p>
      ) : (
        <>
          {!state.active && (
            <section className="research-gate">
              <h2>
                {state.catalog ? "研究目录已停用" : "启用研究版前，先备份旧库"}
              </h2>
              <p>
                备份来自当前网站地址 <code>{window.location.origin}</code>
                。本地地址与原网站各有独立的浏览器数据；当前地址若为空，不能将它当作原网站的用户备份。
              </p>
              <p>
                启用时会下载当前地址的旧库JSON，再在独立 shadow
                库内校验并导入研究目录。历史 V0.19
                的评分、N/A、权重和快照继续原样保留。
              </p>
              <div className="research-actions">
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => void run(enable)}
                >
                  备份旧库并启用研究版
                  <ArrowRight size={15} />
                </button>
                <button
                  className="quiet-link"
                  disabled={busy}
                  onClick={() => restoreInput.current?.click()}
                >
                  恢复研究版备份
                </button>
              </div>
            </section>
          )}
          {record && draft ? (
            <>
              <div className="research-editor-heading">
                <button className="back-link" onClick={() => onNavigate()}>
                  <ArrowLeft size={15} />
                  研究作品库
                </button>
                <div className="research-actions">
                  <button
                    className="quiet-link"
                    aria-pressed={editorTab === "edit"}
                    onClick={() => setEditorTab("edit")}
                  >
                    资料与六维
                  </button>
                  <button
                    className="quiet-link"
                    aria-pressed={editorTab === "card"}
                    onClick={() => setEditorTab("card")}
                  >
                    评分卡与导出
                  </button>
                </div>
              </div>
              {snapshot && (
                <div className="research-notice">
                  不可变研究快照 · {date(snapshot.createdAt)} ·{" "}
                  {snapshot.display} / 10
                  <div className="research-actions">
                    <code>{snapshot.id}</code>
                    <button
                      className="button secondary small"
                      disabled={busy || !state.active}
                      onClick={() => void run(newRevision)}
                    >
                      另存为新修订
                    </button>
                  </div>
                </div>
              )}
              {draft.parent && (
                <div className="research-parent">
                  派生自 {draft.parent.modelVersion} ·{" "}
                  {draft.parent.snapshotId ?? draft.parent.albumId}
                  {draft.parent.score ? ` · 原分数 ${draft.parent.score}` : ""}
                  。旧记录未改写；V0.19 的评分与N/A没有转入新六维。
                </div>
              )}
              {editorTab === "edit" ? (
                <>
                  <section className="research-section">
                    <h2>专辑资料</h2>
                    <div className="research-fields">
                      <label>
                        专辑名
                        <input
                          aria-label="研究专辑名"
                          disabled={readonly || busy}
                          value={draft.title}
                          onChange={(e) => update({ title: e.target.value })}
                        />
                      </label>
                      <label>
                        音乐人
                        <input
                          aria-label="研究音乐人"
                          disabled={readonly || busy}
                          value={draft.artist}
                          onChange={(e) => update({ artist: e.target.value })}
                        />
                      </label>
                      <label>
                        年份
                        <input
                          aria-label="研究年份"
                          disabled={readonly || busy}
                          value={draft.year}
                          onChange={(e) => update({ year: e.target.value })}
                        />
                      </label>
                      <label>
                        发行版次与来源
                        <input
                          aria-label="研究发行版次与来源"
                          disabled={readonly || busy}
                          value={draft.release}
                          onChange={(e) => update({ release: e.target.value })}
                        />
                      </label>
                      <label>
                        作品类型
                        <select
                          disabled={readonly || busy}
                          value={draft.kind}
                          onChange={(e) =>
                            update({ kind: e.target.value as "专辑" | "EP" })
                          }
                        >
                          <option>专辑</option>
                          <option>EP</option>
                        </select>
                      </label>
                      <label>
                        评价人
                        <input
                          aria-label="研究评价人"
                          disabled={readonly || busy}
                          value={draft.reviewer}
                          onChange={(e) => update({ reviewer: e.target.value })}
                        />
                      </label>
                    </div>
                    <div className="research-actions">
                      <button
                        className="button secondary small"
                        disabled={readonly || busy}
                        onClick={() => coverInput.current?.click()}
                      >
                        上传封面
                      </button>
                      {draft.cover && (
                        <img
                          className="research-cover-thumb"
                          src={draft.cover}
                          alt="当前专辑封面"
                        />
                      )}
                      {draft.importSource && (
                        <small>
                          元数据来源：{draft.importSource.provider} ·{" "}
                          {draft.importSource.url}
                        </small>
                      )}
                    </div>
                    <input
                      ref={coverInput}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file)
                          void run(async () => {
                            const cover = await blobToCoverDataURL(file);
                            const next = {
                              ...latest.current!,
                              cover,
                              updatedAt: new Date().toISOString(),
                            };
                            latest.current = next;
                            setDraft(next);
                            await saveResearchDraft(next);
                            setStatus("已保存");
                          });
                      }}
                    />
                    <details>
                      <summary>曲目与时长（{draft.tracks.length}）</summary>
                      <p className="research-muted">
                        曲目资料不会自动推断风格或星级。
                      </p>
                      {draft.tracks.map((t, i) => (
                        <div className="research-track" key={t.id}>
                          <span>{i + 1}</span>
                          <input
                            aria-label={`研究曲目${i + 1}名称`}
                            disabled={readonly || busy}
                            value={t.title}
                            onChange={(e) =>
                              update({
                                tracks: draft.tracks.map((x) =>
                                  x.id === t.id
                                    ? { ...x, title: e.target.value }
                                    : x,
                                ),
                              })
                            }
                          />
                          <input
                            aria-label={`研究曲目${i + 1}秒数`}
                            type="number"
                            min="0"
                            disabled={readonly || busy}
                            value={t.duration || ""}
                            onChange={(e) =>
                              update({
                                tracks: draft.tracks.map((x) =>
                                  x.id === t.id
                                    ? {
                                        ...x,
                                        duration: Math.max(
                                          0,
                                          Number(e.target.value) || 0,
                                        ),
                                      }
                                    : x,
                                ),
                              })
                            }
                          />
                          <small>秒</small>
                        </div>
                      ))}
                      <button
                        className="quiet-link"
                        disabled={readonly || busy}
                        onClick={() =>
                          update({
                            tracks: [
                              ...draft.tracks,
                              { id: createId(), title: "", duration: 0 },
                            ],
                          })
                        }
                      >
                        添加曲目
                      </button>
                    </details>
                  </section>
                  <section className="research-section">
                    <h2>一个主风格</h2>
                    <p className="research-muted">
                      主风格决定整碟权重。辅助标签只描述作品，不混算权重，也不依据语言、地区或厂牌自动加权。
                    </p>
                    <ResearchGenrePicker
                      key={`${draft.id}:${snapshot?.id ?? ""}`}
                      value={draft.coreGenreId}
                      override={draft.explicitResearchOverride}
                      disabled={readonly || busy}
                      onChoose={(id, override) =>
                        update({
                          coreGenreId: id,
                          explicitResearchOverride: override,
                          auxiliaryGenreIds: draft.auxiliaryGenreIds.filter(
                            (x) => x !== id,
                          ),
                        })
                      }
                    />
                    <div className="research-aux">
                      <h3>辅助标签 · 最多2个</h3>
                      <div className="research-actions">
                        {draft.auxiliaryGenreIds.map((id) => (
                          <button
                            className="research-chip"
                            key={id}
                            disabled={readonly || busy}
                            onClick={() =>
                              update({
                                auxiliaryGenreIds:
                                  draft.auxiliaryGenreIds.filter(
                                    (x) => x !== id,
                                  ),
                              })
                            }
                          >
                            {genreById.get(id)?.name_zh} ×
                          </button>
                        ))}
                      </div>
                      {!readonly && (
                        <>
                          <input
                            aria-label="搜索研究辅助标签"
                            value={auxQuery}
                            onChange={(e) => setAuxQuery(e.target.value)}
                            placeholder="搜索标签（不参与计分）"
                          />
                          {auxQuery.trim() && (
                            <div className="research-tag-options">
                              {searchGenres(auxQuery)
                                .filter(
                                  (g) =>
                                    g.id !== draft.coreGenreId &&
                                    !draft.auxiliaryGenreIds.includes(g.id),
                                )
                                .slice(0, 12)
                                .map((g) => (
                                  <button
                                    key={g.id}
                                    disabled={
                                      busy ||
                                      draft.auxiliaryGenreIds.length >= 2
                                    }
                                    onClick={() => {
                                      update({
                                        auxiliaryGenreIds: [
                                          ...draft.auxiliaryGenreIds,
                                          g.id,
                                        ],
                                      });
                                      setAuxQuery("");
                                    }}
                                  >
                                    {g.name_zh} / {g.name_en}
                                  </button>
                                ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </section>
                  <section className="research-section">
                    <h2>第一维的作品内容</h2>
                    <div
                      className="research-mode"
                      role="group"
                      aria-label="第一维模式"
                    >
                      {(["lyrics", "expression", "mixed"] as const).map(
                        (mode) => (
                          <button
                            key={mode}
                            disabled={readonly || busy}
                            aria-pressed={draft.firstMode === mode}
                            onClick={() =>
                              update({
                                firstMode: mode,
                                midpointReviewed: false,
                              })
                            }
                          >
                            {labels(mode).first.zh}
                            <small>{labels(mode).first.en}</small>
                          </button>
                        ),
                      )}
                    </div>
                    <p className="research-muted">
                      有实质语义语言用 Lyrics；纯器乐、无词人声和无语义采样用
                      Expression。未知语言不是无语义；混合作品须分曲取证后人工裁定整碟第一维。
                    </p>
                    {draft.firstMode === "mixed" && (
                      <ResearchFirstUnits
                        draft={draft}
                        disabled={readonly || busy}
                        onChange={update}
                      />
                    )}
                  </section>
                  <section className="research-section">
                    <div className="research-section-heading">
                      <h2>六维半星</h2>
                      <div className="research-total">
                        {snapshot?.display ??
                          calculation?.score?.display ??
                          "—"}
                        <small>/ 10 · 研究试评</small>
                      </div>
                    </div>
                    {DIMENSIONS.map((k) => (
                      <article className="research-rating" key={k}>
                        <div className="research-rating-heading">
                          <div>
                            <h3>
                              {naming[k].zh}
                              <small>{naming[k].en}</small>
                            </h3>
                            <span>
                              {(snapshot?.weightsSnapshotTicks ??
                                calculation?.weights)?.[k] !== undefined
                                ? `${(snapshot?.weightsSnapshotTicks ?? calculation!.weights)![k] / 2}%`
                                : "待选主风格"}
                            </span>
                          </div>
                          <StarRating
                            label={`研究${naming[k].zh}`}
                            value={
                              draft.ratings[k] === null
                                ? null
                                : draft.ratings[k]! / 2
                            }
                            disabled={readonly || busy}
                            onChange={(v) => rating(k, v)}
                          />
                        </div>
                        <details>
                          <summary>
                            作品证据 ·{" "}
                            {draft.evidence[k].status === "supported"
                              ? "已提供证据"
                              : draft.evidence[k].status === "insufficient"
                                ? "证据不足"
                                : "待核对"}
                          </summary>
                          <label>
                            证据状态
                            <select
                              aria-label={`${naming[k].zh}证据状态`}
                              disabled={readonly || busy}
                              value={draft.evidence[k].status}
                              onChange={(e) =>
                                evidence(k, {
                                  status: e.target
                                    .value as ResearchDraft["evidence"][Dimension]["status"],
                                })
                              }
                            >
                              <option value="unreviewed">待核对</option>
                              <option value="supported">已提供证据</option>
                              <option value="insufficient">证据不足</option>
                            </select>
                          </label>
                          {(
                            [
                              ["support", "正例（曲目／时间码）"],
                              ["counterexample", "反例或局部不足"],
                              ["rationale", "整碟判断理由"],
                              ["adjacentGrade", "与相邻半星的区别"],
                            ] as const
                          ).map(([field, label]) => (
                            <label key={field}>
                              {label}
                              <textarea
                                aria-label={`${naming[k].zh}${label}`}
                                disabled={readonly || busy}
                                value={draft.evidence[k][field]}
                                onChange={(e) =>
                                  evidence(k, { [field]: e.target.value })
                                }
                              />
                            </label>
                          ))}
                        </details>
                      </article>
                    ))}
                    {!snapshot &&
                      calculation?.errors.map((e) => (
                        <p className="research-validation" key={e}>
                          {e}
                        </p>
                      ))}
                    {calculation?.warnings.map((w) => (
                      <p className="research-muted" key={w}>
                        {w}
                      </p>
                    ))}
                  </section>
                  <section className="research-section">
                    <h2>听评与状态</h2>
                    <label className="research-checkbox">
                      <input
                        type="checkbox"
                        checked={draft.fullAlbumListeningVerified}
                        disabled={readonly || busy}
                        onChange={(e) =>
                          update({
                            fullAlbumListeningVerified: e.target.checked,
                          })
                        }
                      />
                      已完整复听
                    </label>
                    <label className="research-checkbox">
                      <input
                        type="checkbox"
                        checked={draft.sourceEditionVerified}
                        disabled={readonly || busy}
                        onChange={(e) =>
                          update({ sourceEditionVerified: e.target.checked })
                        }
                      />
                      已核对发行版次及来源
                    </label>
                    <label>
                      短评
                      <textarea
                        aria-label="研究短评"
                        maxLength={200}
                        disabled={readonly || busy}
                        value={draft.summary}
                        onChange={(e) => update({ summary: e.target.value })}
                      />
                    </label>
                    <label>
                      工作状态
                      <select
                        disabled={readonly || busy}
                        value={draft.status}
                        onChange={(e) =>
                          update({
                            status: e.target.value as ResearchDraft["status"],
                          })
                        }
                      >
                        <option value="draft">草稿</option>
                        <option value="research_only">研究性试评</option>
                        <option value="in_review">待独立审核</option>
                      </select>
                    </label>
                    <details>
                      <summary>正式发布仍需完成的事项</summary>
                      <ul>
                        {calculation?.publicationBlockers.map((b) => (
                          <li key={b}>{b}</li>
                        ))}
                      </ul>
                    </details>
                  </section>
                  <div className="research-actions">
                    <button
                      className="button primary"
                      disabled={
                        readonly ||
                        busy ||
                        !calculation?.complete ||
                        !draft.title.trim() ||
                        !draft.artist.trim()
                      }
                      onClick={() => void run(freeze)}
                    >
                      保存不可变研究快照
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => setEditorTab("card")}
                    >
                      查看评分卡
                      <ArrowRight size={15} />
                    </button>
                  </div>
                </>
              ) : (
                <section className="research-card-page">
                  <div className="research-actions">
                    <label>
                      比例
                      <select
                        aria-label="研究评分卡比例"
                        value={viewRatio ?? draft.cardRatio}
                        onChange={(e) => {
                          const ratio = e.target
                            .value as ResearchDraft["cardRatio"];
                          if (readonly) setViewRatio(ratio);
                          else update({ cardRatio: ratio });
                        }}
                      >
                        <option>4:5</option>
                        <option>3:4</option>
                        <option>1:1</option>
                      </select>
                    </label>
                    <label>
                      主题
                      <select
                        aria-label="研究评分卡主题"
                        value={viewTheme ?? draft.cardTheme}
                        onChange={(e) => {
                          const theme = e.target
                            .value as ResearchDraft["cardTheme"];
                          if (readonly) setViewTheme(theme);
                          else update({ cardTheme: theme });
                        }}
                      >
                        <option value="paper">纸色</option>
                        <option value="ink">深色</option>
                      </select>
                    </label>
                    {!snapshot && (
                      <button
                        className="button primary"
                        disabled={
                          readonly ||
                          busy ||
                          !calculation?.complete ||
                          !draft.title.trim() ||
                          !draft.artist.trim()
                        }
                        onClick={() => void run(freeze)}
                      >
                        保存不可变研究快照
                      </button>
                    )}
                  </div>
                  <div className="research-card-preview" ref={card}>
                    {cardData && (
                      <ScoreCard
                        data={cardData}
                        ratio={viewRatio ?? draft.cardRatio}
                        theme={viewTheme ?? draft.cardTheme}
                      />
                    )}
                  </div>
                  {snapshot ? (
                    <>
                      <div className="research-actions">
                        <button
                          className="button primary"
                          disabled={busy}
                          onClick={() => exportImage("png")}
                        >
                          导出研究PNG
                        </button>
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() => exportImage("svg")}
                        >
                          SVG
                        </button>
                        <button
                          className="button secondary"
                          onClick={() =>
                            download(
                              snapshotJSON(snapshot),
                              `${filename(draft.title)}-研究快照.json`,
                            )
                          }
                        >
                          JSON快照
                        </button>
                        <button
                          className="button secondary"
                          onClick={() =>
                            download(
                              snapshotCSV(snapshot),
                              `${filename(draft.title)}-研究快照.csv`,
                              "text/csv",
                            )
                          }
                        >
                          CSV快照
                        </button>
                      </div>
                      <p className="research-muted">
                        快照校验：<code>{snapshot.integrityHash}</code>。JSON /
                        CSV包含全部证据和不可变快照；SVG内嵌相同研究元数据。PNG显示研究标识、六维星级、权重与版本。
                      </p>
                    </>
                  ) : (
                    <p className="research-muted">
                      导出前先保存不可变研究快照。未完成的评分仍可保留为草稿。
                    </p>
                  )}
                  <details>
                    <summary>本次六维证据与审核状态</summary>
                    {DIMENSIONS.map((k) => (
                      <div key={k}>
                        <h3>
                          {naming[k].zh} / {naming[k].en}
                        </h3>
                        <p>{draft.evidence[k].support || "正例待提供"}</p>
                        <p>
                          {draft.evidence[k].counterexample || "反例待提供"}
                        </p>
                        <p>{draft.evidence[k].rationale || "理由待提供"}</p>
                      </div>
                    ))}
                  </details>
                </section>
              )}
            </>
          ) : !record && tab === "catalog" ? (
            <section className="research-section">
              <h2>冻结的 V0.34 研究目录</h2>
              <p>
                34一级 · 565稳定ID · 522数值候选 · 43索引 · 5待定义 ·
                181专项记录（其中4项已清除索引残值）。正式批准0套。
              </p>
              <ResearchGenrePicker />
            </section>
          ) : !record && tab === "data" ? (
            <section className="research-section">
              <h2>备份、事务与回滚</h2>
              <p>
                旧库保持 nmc-workbench-v1 v1。新库为 mumaka-v035-shadow
                v1，历史评分不会自动重算。停用研究目录保留所有新草稿、快照和检查点，可重新启用。
              </p>
              <dl className="research-audit">
                <dt>目录校验</dt>
                <dd>{state.catalog?.hash ?? "尚未导入"}</dd>
                <dt>模型 / 权重</dt>
                <dd>
                  {MODEL_VERSION} / {WEIGHT_VERSION}
                </dd>
                <dt>自动正式批准</dt>
                <dd>0</dd>
              </dl>
              <div className="research-actions">
                <button
                  className="button secondary"
                  disabled={busy || !state.catalog}
                  onClick={() =>
                    void run(async () =>
                      download(
                        await exportResearchBackup(),
                        "MUMAKA-V035-shadow-备份.json",
                      ),
                    )
                  }
                >
                  导出研究库完整备份
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => restoreInput.current?.click()}
                >
                  恢复研究库备份
                </button>
                <button
                  className="button secondary"
                  disabled={busy || !state.active}
                  onClick={() =>
                    void run(async () => {
                      await deactivateResearchCatalog();
                      await refresh();
                      setStatus("研究目录已停用；历史记录及检查点保留。");
                    })
                  }
                >
                  停用研究目录并回滚入口
                </button>
              </div>
            </section>
          ) : (
            !record && (
              <>
                <div className="research-actions">
                  <button
                    className="button primary"
                    disabled={busy || !state.active}
                    onClick={() => void run(() => create())}
                  >
                    <Plus size={15} />
                    新建研究评分
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy || !state.active}
                    onClick={() => setImportOpen(true)}
                  >
                    通过链接添加研究作品
                  </button>
                </div>
                <section className="research-section">
                  <h2>研究作品 · {state.drafts.length}</h2>
                  {state.drafts.length ? (
                    <div className="research-records">
                      {state.drafts.map((d) => (
                        <button
                          className="research-record"
                          key={d.id}
                          onClick={() =>
                            onNavigate({ kind: "draft", id: d.id })
                          }
                        >
                          <span className="research-record-cover">
                            {d.cover ? (
                              <img src={d.cover} alt="" />
                            ) : (
                              <Disc3 size={25} />
                            )}
                          </span>
                          <span>
                            <b>{d.title || "未命名研究草稿"}</b>
                            <small>
                              {d.artist || "未填写音乐人"} · {d.status}
                            </small>
                          </span>
                          <span>
                            {calculateResearch(d).score?.display ?? "—"}
                          </span>
                          <ArrowRight size={15} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="quiet-message">
                      暂无研究作品。所有星级从未评分开始。
                    </p>
                  )}
                </section>
                <section className="research-section">
                  <h2>不可变研究记录 · {state.revisions.length}</h2>
                  {state.revisions.map((s) => (
                    <button
                      className="research-record"
                      key={s.id}
                      onClick={() => onNavigate({ kind: "revision", id: s.id })}
                    >
                      <span>
                        <b>{s.album.title}</b>
                        <small>
                          {date(s.createdAt)} · {s.modelVersion} · research_only
                        </small>
                      </span>
                      <b>{s.display}</b>
                      <ArrowRight size={15} />
                    </button>
                  ))}
                  {!state.revisions.length && (
                    <p className="quiet-message">尚未保存研究快照。</p>
                  )}
                </section>
                <section className="research-section">
                  <h2>从 V0.19 另建草稿</h2>
                  <p className="research-muted">
                    只复制专辑资料、曲目和来源。六维星级、N/A、证据与修正均不迁入；旧记录继续使用V0.19。
                  </p>
                  <div className="research-actions">
                    <select
                      aria-label="选择旧版作品"
                      value={legacyChoice}
                      onChange={(e) => setLegacyChoice(e.target.value)}
                    >
                      <option value="">选择旧版作品</option>
                      {legacyAlbums.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.title || "未命名"} · {a.artist} · 原分数{" "}
                          {libraryCalculation(a, legacySnapshots)?.total ?? "—"}
                        </option>
                      ))}
                    </select>
                    <button
                      className="button secondary"
                      disabled={!legacyChoice || !state.active || busy}
                      onClick={() =>
                        void run(async () => {
                          const a = legacyAlbums.find(
                            (a) => a.id === legacyChoice,
                          )!;
                          const s = legacySnapshots.find(
                            (s) =>
                              s.albumId === a.id &&
                              s.album.revision === a.revision &&
                              s.album.updatedAt === a.updatedAt &&
                              s.kind === "published",
                          );
                          const prior = s?.provenance;
                          const sourceModelVersion =
                            prior &&
                            typeof prior === "object" &&
                            "modelVersion" in prior &&
                            typeof prior.modelVersion === "string"
                              ? prior.modelVersion
                              : "v0.19";
                          await create(
                            fromLegacy(
                              a,
                              s?.id,
                              libraryCalculation(a, legacySnapshots)?.total,
                              sourceModelVersion,
                            ),
                          );
                        })
                      }
                    >
                      复制资料为V0.35新草稿
                    </button>
                  </div>
                </section>
              </>
            )
          )}
        </>
      )}
      <input
        ref={restoreInput}
        hidden
        type="file"
        accept=".json,application/json"
        onChange={(e) => void restore(e.target.files?.[0])}
      />
      {importOpen && (
        <div className="modal-shade">
          <section
            className="settings-modal research-import-modal"
            role="dialog"
            aria-modal="true"
            aria-label="通过链接添加研究作品"
          >
            <div className="modal-heading">
              <h2>通过链接添加研究作品</h2>
              <button
                className="icon-button"
                aria-label="关闭研究导入"
                onClick={() => setImportOpen(false)}
              >
                ×
              </button>
            </div>
            <p className="research-muted">
              沿用已有元数据链路，最终星级与主风格由你确认。真实平台连通状态与模型测试分别验收。
            </p>
            <AlbumImportPanel
              albums={duplicateAlbums}
              busy={busy}
              onConfirm={importAlbum}
              onOpen={async (a) => {
                if (state.drafts.some((d) => d.id === a.id))
                  onNavigate({ kind: "draft", id: a.id });
                else await onOpenLegacy(a);
              }}
              onManual={() => void run(() => create())}
            />
          </section>
        </div>
      )}
      <footer className="research-footer">
        {catalogCounts.families}一级 · {catalogCounts.stableIds}稳定ID ·
        research_candidate · 本地研究，不自动发布
      </footer>
    </main>
  );
}
