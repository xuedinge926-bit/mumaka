import { useEffect, useRef, useState } from "react";
import { Disc3, Plus, ImagePlus, Download } from "lucide-react";
import type { Album } from "../model/types";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  NAMES,
  ENGLISH,
  MODEL_VERSION,
  newDraft,
  fromLegacy,
  type Draft,
  type Category,
  type Catalog,
  type Snapshot,
  type Six,
} from "../model/v040/types";
import { HELP } from "../model/v040/definitions";
import { bundledCatalog } from "../model/v040/catalog";
import { calculate, canSnapshot, ratingView } from "../model/v040/engine";
import * as storage from "../lib/v040Storage";
import { downloadBlob, exportPNG, exportSVG } from "../lib/exports";
import { evaluationCSV } from "../lib/v040Exports";
import { blobToCoverDataURL } from "../lib/images";
import { importedAlbum } from "../lib/albumImport";
import { createId } from "../lib/browserCrypto";
import { DimensionRating } from "./DimensionRating";
import { readPreferences } from "../lib/preferences";
import { DualScoreCard } from "./DualScoreCard";
import { AlbumImportPanel } from "./AlbumImportPanel";
import "./dual.css";

export type DualRecordRoute = { kind: "draft" | "revision"; id: string };
type View = "studio" | "library" | "ratings" | "data" | "cards";
interface Props {
  record?: DualRecordRoute;
  view?: View;
  onNavigate: (record?: DualRecordRoute) => void;
  legacyAlbums: Album[];
  onOpenLegacy: (album: Album) => Promise<void>;
}
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const date = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
const download = (value: string, name: string, type = "application/json") =>
  downloadBlob(new Blob([value], { type: `${type};charset=utf-8` }), name);

export function DualWorkspace({
  record,
  view = "studio",
  onNavigate,
  legacyAlbums,
  onOpenLegacy,
}: Props) {
  const [catalog, setCatalog] = useState<Catalog>(bundledCatalog),
    [draft, setDraft] = useState<Draft | null>(null),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]),
    [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(""),
    [family, setFamily] = useState(""),
    [genreQuery, setGenreQuery] = useState(""),
    [importOpen, setImportOpen] = useState(false);
  const [legacyChoice, setLegacyChoice] = useState("");
  const latest = useRef<Draft | null>(null),
    mounted = useRef(true),
    card = useRef<HTMLDivElement>(null),
    lock = useRef(false),
    editSequence = useRef(0);
  const coverInput = useRef<HTMLInputElement>(null),
    backupInput = useRef<HTMLInputElement>(null),
    catalogInput = useRef<HTMLInputElement>(null);
  const readonly = !!snapshot;
  const calculation = draft
    ? (snapshot?.calculation ?? calculate(draft, catalog))
    : null;
  async function refresh() {
    const s = await storage.state();
    if (mounted.current) {
      setCatalog(s.catalog);
      setDrafts(s.drafts);
      setSnapshots(s.snapshots);
    }
    return s;
  }
  useEffect(() => {
    mounted.current = true;
    let canceled = false;
    setLoading(true);
    setError("");
    setImportOpen(false);
    (async () => {
      try {
        if (view === "studio") await storage.initialize();
        const s = await storage.state();
        if (canceled) return;
        setCatalog(s.catalog);
        setDrafts(s.drafts);
        setSnapshots(s.snapshots);
        if (view !== "studio") {
          setDraft(null);
          latest.current = null;
          setSnapshot(null);
          return;
        }
        let frozen: Snapshot | null = null;
        if (record?.kind === "revision") {
          const candidate = s.snapshots.find((r) => r.id === record.id);
          if (!candidate) throw new Error("未找到该历史快照");
          frozen = await storage.verifySnapshot(candidate);
        }
        let current =
          frozen?.draft ?? s.drafts.find((d) => d.id === record?.id);
        if (record && !current)
          throw new Error("未找到该V0.40记录，请从作品库打开");
        if (!current) {
          let remembered = "";
          try {
            remembered = localStorage.getItem("mumaka-v040-last") ?? "";
          } catch {
            /* optional */
          }
          current = s.drafts.find((d) => d.id === remembered) ?? s.drafts[0];
          if (!current) {
            current = newDraft();
            await storage.saveDraft(current);
          }
        }
        if (canceled) return;
        setDraft(current);
        latest.current = current;
        setSnapshot(frozen);
        setStatus(frozen ? "历史快照 · 只读" : "已自动保存");
        setFamily(
          (frozen?.catalogSnapshot ?? s.catalog).genres.find(
            (g) => g.id === current!.modes[current!.category].genreId,
          )?.familyId ?? "",
        );
        setGenreQuery("");
        if (!frozen) {
          try {
            localStorage.setItem("mumaka-v040-last", current.id);
          } catch {
            /* optional */
          }
        }
      } catch (e) {
        if (!canceled) setError(message(e));
      } finally {
        if (!canceled) setLoading(false);
      }
    })();
    return () => {
      canceled = true;
      mounted.current = false;
    };
  }, [record?.kind, record?.id, view]);
  function change(fn: (next: Draft) => void) {
    if (!latest.current || readonly || lock.current) return;
    const next = structuredClone(latest.current);
    fn(next);
    next.revision++;
    next.updatedAt = new Date().toISOString();
    latest.current = next;
    setDraft(next);
    setStatus("正在自动保存…");
    setError("");
    const sequence = ++editSequence.current;
    storage
      .saveDraft(next)
      .then(() => {
        if (mounted.current && sequence === editSequence.current)
          setStatus("已自动保存");
      })
      .catch((e) => {
        if (mounted.current) {
          setStatus("保存失败");
          setError(message(e));
        }
      });
  }
  async function run(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await storage.flushWrites();
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function create(next?: Draft) {
    if (!next) {
      const p = readPreferences();
      next = {
        ...newDraft(),
        region: p.market,
        cardRatio: p.cardRatio,
        cardTheme: p.cardTheme,
      };
    }
    await storage.initialize();
    await storage.saveDraft(next);
    onNavigate({ kind: "draft", id: next.id });
  }
  const activeCatalog = snapshot
    ? { ...catalog, ...snapshot.catalogSnapshot }
    : catalog;
  const mode = draft?.modes[draft.category];
  const genre = activeCatalog.genres.find((g) => g.id === mode?.genreId);
  const profile = draft ? genre?.profiles[draft.category] : null;
  const genreOptions = catalog.genres.filter(
    (g) =>
      (!family || g.familyId === family) &&
      `${g.name} ${g.nameEn} ${g.id}`
        .toLowerCase()
        .includes(genreQuery.toLowerCase()),
  );
  const fileName = (draft?.title || "未命名专辑").replace(
    /[\\/:*?"<>|]/gu,
    "_",
  );
  function categoryChanged(category: Category) {
    change((d) => {
      d.category = category;
    });
    setFamily(
      catalog.genres.find(
        (g) => g.id === latest.current?.modes[category].genreId,
      )?.familyId ?? "",
    );
    setGenreQuery("");
  }
  async function image(kind: "png" | "svg") {
    const svg = card.current?.querySelector<SVGSVGElement>("#score-card-svg");
    if (!svg) throw new Error("评分卡尚未生成");
    await (kind === "png" ? exportPNG : exportSVG)(
      svg,
      `${fileName}-${MODEL_VERSION}.${kind}`,
    );
  }
  const lists = (
    <section className="dual-library" aria-label="V0.40作品与历史">
      <div className="dual-heading">
        <div>
          <p className="dual-eyebrow">DUAL MODEL · {MODEL_VERSION}</p>
          <h2>
            {view === "ratings"
              ? "评分记录"
              : view === "cards"
                ? "评分卡"
                : "作品库"}
          </h2>
        </div>
        <button
          className="button primary"
          disabled={busy}
          onClick={() => run(() => create())}
        >
          <Plus size={15} />
          添加评分
        </button>
      </div>
      <input
        aria-label="搜索双体系作品"
        placeholder="搜索专辑或艺术家"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {view !== "ratings" && view !== "cards" && (
        <div className="dual-records">
          {drafts
            .filter((d) => `${d.title} ${d.artist}`.includes(query))
            .map((d) => (
              <article key={d.id}>
                <div>
                  <b>{d.title || "未命名专辑"}</b>
                  <p>
                    {d.artist || "未填写艺术家"} · {CATEGORY_LABELS[d.category]}
                    {d.mixed.enabled ? " · 混合" : ""}
                  </p>
                  <small>{date(d.updatedAt)} · 独立双草稿</small>
                </div>
                <div className="dual-actions">
                  <button
                    onClick={() => onNavigate({ kind: "draft", id: d.id })}
                  >
                    打开
                  </button>
                  <button
                    onClick={() =>
                      run(async () => {
                        const copy = {
                          ...structuredClone(d),
                          id: createId(),
                          revision: 1,
                          createdAt: new Date().toISOString(),
                          updatedAt: new Date().toISOString(),
                        };
                        await create(copy);
                      })
                    }
                  >
                    复制
                  </button>
                  <button
                    onClick={() =>
                      run(async () => {
                        await storage.deleteDraft(d.id);
                        await refresh();
                        setStatus("草稿已删除，历史快照仍保留");
                      })
                    }
                  >
                    删除草稿
                  </button>
                </div>
              </article>
            ))}
        </div>
      )}
      <h3>冻结的评分版本</h3>
      <div className="dual-records">
        {snapshots
          .filter((s) => `${s.draft.title} ${s.draft.artist}`.includes(query))
          .map((s) => (
            <article key={s.id}>
              <div>
                <b>
                  {s.draft.title}{" "}
                  <span className="dual-score-small">
                    {s.calculation.total}
                  </span>
                </b>
                <p>
                  {s.draft.artist} · {s.modelVersion} · {s.weightVersion} ·{" "}
                  {s.status === "published" ? "人工批准" : "研究候选"}
                </p>
                <small>
                  {date(s.createdAt)} · {s.id}
                </small>
              </div>
              <button
                onClick={() => onNavigate({ kind: "revision", id: s.id })}
              >
                查看冻结卡片
              </button>
            </article>
          ))}
      </div>
      {!drafts.length && !snapshots.length && (
        <p className="dual-muted">
          还没有双体系记录。旧版作品与历史继续保留在下方原作品库中。
        </p>
      )}
    </section>
  );
  const dataPanel = (
    <section className="dual-panel dual-data" aria-label="V0.40数据管理">
      <h2>双体系数据与版本</h2>
      <p>
        本机保存，研究数据包可替换；旧快照始终读取其冻结权重。旧版数据库
        nmc-workbench-v1 保持版本1。
      </p>
      <div className="dual-actions">
        <button
          className="button secondary"
          disabled={busy}
          onClick={() =>
            run(async () =>
              download(await storage.exportBackup(), "MUMAKA-v040-backup.json"),
            )
          }
        >
          导出V0.40完整备份
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => backupInput.current?.click()}
        >
          恢复V0.40备份
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() =>
            run(async () =>
              download(
                JSON.stringify(catalog, null, 2),
                "MUMAKA-v038-model.json",
              ),
            )
          }
        >
          导出研究数据包
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => catalogInput.current?.click()}
        >
          导入V0.38数据包
        </button>
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              const json = await storage.legacyCheckpoint();
              if (!json)
                throw new Error("尚无升级前副本，首次新评分时会在本机建立");
              download(json, "MUMAKA-pre-v040-legacy-backup.json");
            })
          }
        >
          下载升级前旧库副本
        </button>
      </div>
      <p className="dual-source">
        {catalog.sourceVersion} · 权重 {catalog.weightVersion} · 来源SHA-256{" "}
        {catalog.sourceSha256}
      </p>
      <p>
        34一级 · 565稳定ID · 522候选 · 43索引 ·
        5定义待审。导入需保留稳定ID、双模式数值、来源与审核状态；不从旧表意／声音改名生成新权重。权重批准需要人工记录，导入不会自动批准。
      </p>
    </section>
  );
  return (
    <main
      className={`dual-workspace ${view !== "studio" ? "dual-embedded" : ""}`}
    >
      {error && (
        <div className="dual-error" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <p role="status">正在读取双体系作品…</p>
      ) : view !== "studio" ? (
        <>{view === "data" ? dataPanel : lists}</>
      ) : draft && mode && calculation ? (
        <>
          <div className="dual-heading">
            <div>
              <p className="dual-eyebrow">ALBUM REVIEW</p>
              <h1>专辑评分工作台</h1>
              <p>从作品出发，留下可追溯的判断。</p>
            </div>
            <span className="dual-save" role="status" title={status}>
              <span aria-hidden="true">
                {status === "保存失败" ? "保存失败" : "●"}
              </span>
              <span className="sr-only">{status}</span>
            </span>
          </div>
          {!readonly && (
            <div className="draft-tabs" role="tablist" aria-label="评分草稿">
              {[...drafts.filter((d) => d.id !== draft.id), draft]
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
                .map((item, i) => (
                  <button
                    key={item.id}
                    role="tab"
                    aria-selected={item.id === draft.id}
                    aria-controls="dual-info"
                    onClick={() =>
                      run(async () => {
                        if (latest.current)
                          await storage.saveDraft(latest.current);
                        onNavigate({ kind: "draft", id: item.id });
                      })
                    }
                  >
                    {item.title || `评分 ${i + 1}`}
                  </button>
                ))}
              <button
                className="draft-add"
                aria-label="添加评分草稿"
                onClick={() =>
                  run(async () => {
                    if (latest.current) await storage.saveDraft(latest.current);
                    await create();
                  })
                }
              >
                <Plus size={16} />
              </button>
            </div>
          )}
          <div className="dual-topline">
            <div className="dual-segment" role="group" aria-label="作品类别">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  disabled={readonly || busy}
                  aria-pressed={draft.category === c}
                  onClick={() => categoryChanged(c)}
                >
                  {CATEGORY_LABELS[c]}
                </button>
              ))}
            </div>
            <nav aria-label="页面内分区">
              <a
                href="#dual-info"
                onClick={(e) => {
                  e.preventDefault();
                  document
                    .getElementById("dual-info")
                    ?.scrollIntoView({ behavior: document.documentElement.dataset.reduceMotion === "true" ? "auto" : "smooth" });
                }}
              >
                信息
              </a>
              <a
                href="#dual-genres"
                onClick={(e) => {
                  e.preventDefault();
                  document
                    .getElementById("dual-genres")
                    ?.scrollIntoView({ behavior: document.documentElement.dataset.reduceMotion === "true" ? "auto" : "smooth" });
                }}
              >
                风格
              </a>
              <a
                href="#dual-ratings"
                onClick={(e) => {
                  e.preventDefault();
                  document
                    .getElementById("dual-ratings")
                    ?.scrollIntoView({ behavior: document.documentElement.dataset.reduceMotion === "true" ? "auto" : "smooth" });
                }}
              >
                评分
              </a>
              <a
                href="#dual-preview"
                onClick={(e) => {
                  e.preventDefault();
                  document
                    .getElementById("dual-preview")
                    ?.scrollIntoView({ behavior: document.documentElement.dataset.reduceMotion === "true" ? "auto" : "smooth" });
                }}
              >
                卡片
              </a>
            </nav>
          </div>
          {readonly && (
            <div className="dual-note">
              冻结快照只读：{snapshot!.id}。显示当时的模型、权重、星级和总分。
              <button
                onClick={() =>
                  run(async () => {
                    const next = {
                      ...structuredClone(draft),
                      id: createId(),
                      revision: 1,
                      createdAt: new Date().toISOString(),
                      updatedAt: new Date().toISOString(),
                      parent: {
                        modelVersion: draft.modelVersion,
                        albumId: draft.id,
                        snapshotId: snapshot!.id,
                      },
                    };
                    await create(next);
                  })
                }
              >
                复制为新版本
              </button>
            </div>
          )}
          <div className="dual-layout">
            <div className="dual-edit-column">
              <section id="dual-info" className="dual-panel">
                <div className="dual-section-title">
                  <span>01</span>
                  <h2>专辑信息</h2>
                </div>
                <fieldset disabled={readonly || busy}>
                  <div className="dual-album-info">
                    <button
                      className="dual-cover"
                      aria-label="上传专辑封面"
                      onClick={() => coverInput.current?.click()}
                    >
                      {draft.cover ? (
                        <img src={draft.cover} alt="专辑封面" />
                      ) : (
                        <Disc3 size={50} strokeWidth={1} />
                      )}
                      <ImagePlus size={17} />
                    </button>
                    <div className="dual-fields">
                      <label>
                        专辑名称
                        <input
                          aria-label="专辑名称"
                          value={draft.title}
                          maxLength={250}
                          placeholder="专辑名称"
                          onChange={(e) =>
                            change((d) => {
                              d.title = e.target.value;
                            })
                          }
                        />
                      </label>
                      <label>
                        艺术家
                        <input
                          aria-label="艺术家"
                          value={draft.artist}
                          maxLength={200}
                          placeholder="艺术家 / 乐队"
                          onChange={(e) =>
                            change((d) => {
                              d.artist = e.target.value;
                            })
                          }
                        />
                      </label>
                      <div className="dual-field-row">
                        <label>
                          发行年份
                          <input
                            aria-label="发行年份"
                            value={draft.year}
                            placeholder="年份"
                            onChange={(e) =>
                              change((d) => {
                                d.year = e.target.value;
                              })
                            }
                          />
                        </label>
                        <label>
                          作品类型
                          <select
                            aria-label="作品类型"
                            value={draft.kind}
                            onChange={(e) =>
                              change((d) => {
                                d.kind = e.target.value as Draft["kind"];
                              })
                            }
                          >
                            <option>专辑</option>
                            <option>EP</option>
                          </select>
                        </label>
                      </div>
                    </div>
                  </div>
                  <div className="dual-toolbar">
                    <div
                      className="dual-segment"
                      role="group"
                      aria-label="地区分类"
                    >
                      {(["china", "global"] as const).map((r) => (
                        <button
                          key={r}
                          aria-pressed={draft.region === r}
                          onClick={() =>
                            change((d) => {
                              d.region = r;
                            })
                          }
                        >
                          {r === "china" ? "中国" : "外国"}
                        </button>
                      ))}
                    </div>
                    <label className="dual-checkbox">
                      <input
                        type="checkbox"
                        checked={draft.mixed.enabled}
                        onChange={(e) =>
                          change((d) => {
                            d.mixed.enabled = e.target.checked;
                            d.mixed.reviewed = false;
                          })
                        }
                      />
                      混合歌曲与器乐专辑
                    </label>
                  </div>
                  <label>
                    发行／录音版本
                    <input
                      aria-label="录音版本"
                      value={draft.release}
                      placeholder="原版、再版或具体录音版本"
                      onChange={(e) =>
                        change((d) => {
                          d.release = e.target.value;
                        })
                      }
                    />
                  </label>
                  {draft.mixed.enabled && (
                    <div className="dual-mixed">
                      <h3>按作品艺术比重人工审核</h3>
                      <p>
                        分别填写两类作品的前四维，愿景、语境在专辑层面评价一次。不使用曲目数量或时长自动平均。
                      </p>
                      <label>
                        歌曲艺术比重（%）
                        <input
                          aria-label="歌曲艺术比重"
                          type="number"
                          min="0.5"
                          max="99.5"
                          step="0.5"
                          value={draft.mixed.songShareTicks / 2}
                          onChange={(e) => {
                            const ticks = Number(e.target.value) * 2;
                            if (
                              Number.isSafeInteger(ticks) &&
                              ticks > 0 &&
                              ticks < 200
                            )
                              change((d) => {
                                d.mixed.songShareTicks = ticks;
                                d.mixed.reviewed = false;
                              });
                          }}
                        />
                      </label>
                      <p>
                        乐曲艺术比重：{100 - draft.mixed.songShareTicks / 2}%
                      </p>
                      <label>
                        艺术比重依据
                        <textarea
                          aria-label="艺术比重依据"
                          value={draft.mixed.rationale}
                          placeholder="说明两类作品对整碟艺术经验的贡献与取舍"
                          onChange={(e) =>
                            change((d) => {
                              d.mixed.rationale = e.target.value;
                              d.mixed.reviewed = false;
                            })
                          }
                        />
                      </label>
                      <label>
                        比重审核人
                        <input
                          aria-label="比重审核人"
                          value={draft.mixed.reviewer}
                          onChange={(e) =>
                            change((d) => {
                              d.mixed.reviewer = e.target.value;
                              d.mixed.reviewed = false;
                            })
                          }
                        />
                      </label>
                      <label className="dual-checkbox">
                        <input
                          type="checkbox"
                          checked={draft.mixed.reviewed}
                          disabled={
                            !draft.mixed.rationale.trim() ||
                            !draft.mixed.reviewer.trim()
                          }
                          onChange={(e) =>
                            change((d) => {
                              d.mixed.reviewed = e.target.checked;
                            })
                          }
                        />
                        已人工审核艺术比重
                      </label>
                    </div>
                  )}
                  {!!draft.tracks.length && (
                    <details>
                      <summary>已导入的曲目（{draft.tracks.length}首）</summary>
                      <ol>
                        {draft.tracks.map((t) => (
                          <li key={t.id}>
                            {t.title}{" "}
                            {t.duration
                              ? `· ${Math.floor(t.duration / 60)}:${String(Math.round(t.duration % 60)).padStart(2, "0")}`
                              : ""}
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                </fieldset>
              </section>
              <section id="dual-genres" className="dual-panel">
                <div className="dual-section-title">
                  <span>02</span>
                  <h2>风格与权重</h2>
                </div>
                <fieldset disabled={readonly || busy}>
                  <div className="dual-field-row">
                    <label>
                      一级风格
                      <select
                        aria-label="一级风格"
                        value={family}
                        onChange={(e) => {
                          setFamily(e.target.value);
                          setGenreQuery("");
                          change((d) => {
                            d.modes[d.category].genreId = "";
                            d.mixed.reviewed = false;
                          });
                        }}
                      >
                        <option value="">全部34个音乐家族</option>
                        {catalog.families.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      检索风格
                      <input
                        aria-label="检索双体系风格"
                        value={genreQuery}
                        placeholder="名称、英文或稳定ID"
                        onChange={(e) => setGenreQuery(e.target.value)}
                      />
                    </label>
                  </div>
                  <label>
                    二级风格
                    <select
                      aria-label="二级风格"
                      value={mode.genreId}
                      onChange={(e) =>
                        change((d) => {
                          d.modes[d.category].genreId = e.target.value;
                          d.modes[d.category].applicabilityNote = "";
                          d.mixed.reviewed = false;
                        })
                      }
                    >
                      <option value="">选择具体风格</option>
                      {genre &&
                        !genreOptions.some((g) => g.id === genre.id) && (
                          <option value={genre.id}>{genre.name}</option>
                        )}
                      {genreOptions.map((g) => (
                        <option
                          key={g.id}
                          value={g.id}
                          disabled={
                            g.classification === "index_only" ||
                            !g.profiles[draft.category].trialAllowed
                          }
                        >
                          {g.name} · {g.nameEn} ·{" "}
                          {g.classification === "index_only"
                            ? "索引不可评分"
                            : g.classification === "definition_review"
                              ? "定义待审"
                              : g.profiles[draft.category].applicability}
                        </option>
                      ))}
                    </select>
                  </label>
                  {profile && (
                    <div className="dual-profile">
                      <b>
                        {genre!.name} · {CATEGORY_LABELS[draft.category]} ·{" "}
                        {profile.applicability}
                      </b>

                      {profile.applicability.includes("条件") && (
                        <label>
                          本作品的条件适用依据
                          <textarea
                            aria-label="条件适用依据"
                            value={mode.applicabilityNote}
                            onChange={(e) =>
                              change((d) => {
                                d.modes[d.category].applicabilityNote =
                                  e.target.value;
                              })
                            }
                          />
                        </label>
                      )}
                    </div>
                  )}
                </fieldset>
                <div className="dual-weights" aria-label="当前六维权重">
                  {NAMES[draft.category].map((name, i) => (
                    <div key={name}>
                      <span>{name}</span>
                      <b>
                        {profile?.weightsTicks
                          ? `${profile.weightsTicks[i] / 2}%`
                          : "—"}
                      </b>
                    </div>
                  ))}
                </div>
              </section>
              <section id="dual-ratings" className="dual-panel">
                <div className="dual-section-title">
                  <span>03</span>
                  <h2>六维评分</h2>
                  <small>{CATEGORY_LABELS[draft.category]} · 半星刻度</small>
                </div>
                <fieldset disabled={readonly || busy}>
                  {NAMES[draft.category].map((name, i) => (
                    <DimensionRating
                      key={`${draft.category}-${name}`}
                      category={draft.category}
                      index={i}
                      tick={ratingView(draft)[i]}
                      weight={profile?.weightsTicks?.[i] ?? null}
                      disabled={readonly || busy}
                      shared={draft.mixed.enabled && i >= 4}
                      onChange={(value) =>
                        change((d) => {
                          const ticks = value === null ? null : value * 2;
                          if (d.mixed.enabled && i >= 4) {
                            if (i === 4) d.mixed.visionTicks = ticks;
                            else d.mixed.contextTicks = ticks;
                          } else d.modes[d.category].ratingsTicks[i] = ticks;
                        })
                      }
                    />
                  ))}
                  <details className="optional-notes">
                    <summary>可选笔记与复核</summary>
                    {NAMES[draft.category].map((name, i) => (
                      <label key={name}>
                        {name}笔记
                        <textarea
                          aria-label={`${name}文字证据`}
                          value={
                            draft.mixed.enabled && i >= 4
                              ? i === 4
                                ? draft.mixed.visionEvidence
                                : draft.mixed.contextEvidence
                              : mode.evidence[i]
                          }
                          onChange={(e) =>
                            change((d) => {
                              if (d.mixed.enabled && i >= 4) {
                                if (i === 4)
                                  d.mixed.visionEvidence = e.target.value;
                                else d.mixed.contextEvidence = e.target.value;
                              } else
                                d.modes[d.category].evidence[i] =
                                  e.target.value;
                            })
                          }
                        />
                      </label>
                    ))}
                    <label className="dual-checkbox">
                      <input
                        type="checkbox"
                        checked={mode.performanceUncertain}
                        onChange={(e) =>
                          change((d) => {
                            d.modes[d.category].performanceUncertain =
                              e.target.checked;
                          })
                        }
                      />
                      缺少独立表演证据，标为待复核
                    </label>
                    <p className="dual-muted">
                      程序、算法及电子作品不会被强制低分。待复核期间保留草稿，不生成假定总分。
                    </p>
                    <label>
                      专辑短评
                      <textarea
                        aria-label="专辑短评"
                        value={draft.summary}
                        maxLength={200}
                        onChange={(e) =>
                          change((d) => {
                            d.summary = e.target.value;
                          })
                        }
                      />
                    </label>
                    <label>
                      评分人
                      <input
                        aria-label="评分人"
                        value={draft.reviewer}
                        onChange={(e) =>
                          change((d) => {
                            d.reviewer = e.target.value;
                          })
                        }
                      />
                    </label>
                    <label className="dual-checkbox">
                      <input
                        type="checkbox"
                        checked={draft.fullAlbumListening}
                        onChange={(e) =>
                          change((d) => {
                            d.fullAlbumListening = e.target.checked;
                          })
                        }
                      />
                      已完成整碟试听核验
                    </label>
                  </details>
                </fieldset>
              </section>
            </div>
            <aside id="dual-preview" className="dual-preview-column">
              <section className="dual-panel dual-live">
                <div className="dual-section-title">
                  <span>04</span>
                  <h2>实时评分卡</h2>
                </div>
                <div className="dual-total">
                  <div>
                    <span>加权总分</span>
                    <strong data-testid="dual-total">
                      {calculation.total ?? "—"}
                    </strong>
                  </div>
                  <span>
                    / 10
                    <br />
                  </span>
                </div>
                {calculation.errors.length > 0 && (
                  <details className="dual-calc-notes">
                    <summary>尚待完成（{calculation.errors.length}项）</summary>
                    <ul>
                      {calculation.errors.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  </details>
                )}

                <div className="dual-toolbar">
                  <label>
                    卡片比例
                    <select
                      aria-label="卡片比例"
                      value={draft.cardRatio}
                      disabled={readonly}
                      onChange={(e) =>
                        change((d) => {
                          d.cardRatio = e.target.value as Draft["cardRatio"];
                        })
                      }
                    >
                      {["4:5", "3:4", "1:1"].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    卡片主题
                    <select
                      aria-label="卡片主题"
                      value={draft.cardTheme}
                      disabled={readonly}
                      onChange={(e) =>
                        change((d) => {
                          d.cardTheme = e.target.value as Draft["cardTheme"];
                        })
                      }
                    >
                      <option value="paper">纸色</option>
                      <option value="ink">墨色</option>
                    </select>
                  </label>
                </div>
                <div className="dual-card-preview" ref={card}>
                  <DualScoreCard
                    draft={draft}
                    catalog={activeCatalog}
                    snapshot={snapshot}
                  />
                </div>
                <div className="dual-actions">
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => run(() => image("png"))}
                  >
                    <Download size={14} />
                    PNG
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => run(() => image("svg"))}
                  >
                    SVG
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(async () =>
                        download(
                          evaluationCSV(draft, activeCatalog, snapshot),
                          `${fileName}.csv`,
                          "text/csv",
                        ),
                      )
                    }
                  >
                    CSV
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(async () =>
                        download(
                          JSON.stringify(
                            snapshot ?? {
                              format: "mumaka-v040-evaluation",
                              schemaVersion: 2,
                              draft,
                              calculation,
                              catalogSnapshot: {
                                sourceVersion: catalog.sourceVersion,
                                weightVersion: catalog.weightVersion,
                                sourceSha256: catalog.sourceSha256,
                                genres: catalog.genres.filter((g) =>
                                  CATEGORIES.some(
                                    (c) => draft.modes[c].genreId === g.id,
                                  ),
                                ),
                              },
                            },
                            null,
                            2,
                          ),
                          `${fileName}-evaluation.json`,
                        ),
                      )
                    }
                  >
                    评分JSON
                  </button>
                </div>
                <div className="dual-actions">
                  <button
                    className="button primary"
                    disabled={
                      readonly || busy || !canSnapshot(draft, calculation)
                    }
                    onClick={() =>
                      run(async () => {
                        const saved = await storage.saveSnapshot(
                          latest.current!,
                          catalog,
                        );
                        await refresh();
                        setStatus(
                          `已保存冻结快照 · ${saved.calculation.total}`,
                        );
                      })
                    }
                  >
                    保存评分版本
                  </button>
                </div>
                <p className="dual-source">
                  权重待审定 · 评分版本保存后保留当时的权重与总分。
                </p>
              </section>
            </aside>
          </div>
        </>
      ) : null}
      {status && view !== "studio" && <p role="status">{status}</p>}
      <input
        hidden
        ref={coverInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const target = latest.current?.id;
          blobToCoverDataURL(file)
            .then(async (cover) => {
              if (latest.current?.id === target)
                change((d) => {
                  d.cover = cover;
                });
              else {
                const original = (await storage.state()).drafts.find(
                  (d) => d.id === target,
                );
                if (original)
                  await storage.saveDraft({
                    ...original,
                    cover,
                    revision: original.revision + 1,
                    updatedAt: new Date().toISOString(),
                  });
              }
            })
            .catch((e) => setError(message(e)));
        }}
      />
      <input
        hidden
        ref={backupInput}
        type="file"
        accept="application/json,.json"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file)
            run(async () => {
              const result = await storage.importBackup(await file.text());
              await refresh();
              setStatus(`已恢复${result.added}条记录；同一备份可重复导入。`);
            });
        }}
      />
      <input
        hidden
        ref={catalogInput}
        type="file"
        accept="application/json,.json"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file)
            run(async () => {
              if (file.size > 10_000_000) throw new Error("研究数据包超过10MB");
              await storage.installCatalog(JSON.parse(await file.text()));
              await refresh();
              setStatus("研究数据包已导入，历史评分未重算。");
            });
        }}
      />
    </main>
  );
}
