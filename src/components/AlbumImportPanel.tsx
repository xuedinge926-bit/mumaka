import { useEffect, useRef, useState } from "react";
import { ArrowRight, LoaderCircle, Plus, X } from "lucide-react";
import type { Album } from "../model/types";
import {
  fetchAlbumImport,
  localImporterAvailable,
  possibleDuplicates,
  readImportFile,
  IMPORT_PROVIDER_LABELS,
  type AlbumImport,
  type AlbumMetadata,
} from "../lib/albumImport";
import { blobToCoverDataURL } from "../lib/images";

interface Props {
  albums: Album[];
  busy: boolean;
  onConfirm: (value: AlbumImport) => Promise<void>;
  onOpen: (album: Album) => Promise<void>;
  onManual: () => void;
}

/** Metadata is only staged here. Confirmation creates a fresh record in the existing DB. */
export function AlbumImportPanel({
  albums,
  busy,
  onConfirm,
  onOpen,
  onManual,
}: Props) {
  const [url, setUrl] = useState("");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [value, setValue] = useState<AlbumImport | null>(null);
  const [error, setError] = useState("");
  const [duplicateConfirmed, setDuplicateConfirmed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const check = new AbortController();
    const timer = setTimeout(() => check.abort(), 3000);
    localImporterAvailable(check.signal).then((result) => {
      if (mounted.current) setAvailable(result);
    });
    return () => {
      mounted.current = false;
      clearTimeout(timer);
      check.abort();
      active.current?.abort();
    };
  }, []);
  const disabled = busy || loading;
  const duplicates = value ? possibleDuplicates(value, albums) : [];
  function edit(patch: Partial<AlbumMetadata>) {
    setValue((current) =>
      current ? { ...current, album: { ...current.album, ...patch } } : current,
    );
    setDuplicateConfirmed(false);
  }
  async function fetchInfo() {
    if (disabled) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const timer = setTimeout(() => controller.abort(), 40000);
    setLoading(true);
    setError("");
    try {
      const imported = await fetchAlbumImport(url.trim(), controller.signal);
      if (mounted.current) {
        setValue(imported);
        setDuplicateConfirmed(false);
      }
    } catch (e) {
      if (mounted.current)
        setError(
          controller.signal.aborted
            ? "获取信息已停止或超时，可重试或手动添加。"
            : e instanceof Error
              ? e.message
              : "获取失败，可继续手动添加。",
        );
    } finally {
      clearTimeout(timer);
      if (mounted.current) setLoading(false);
    }
  }
  async function readFile(file?: File) {
    if (!file || disabled) return;
    setLoading(true);
    setError("");
    try {
      const imported = await readImportFile(file);
      if (mounted.current) {
        setValue(imported);
        setDuplicateConfirmed(false);
        setUrl(imported.source.url);
      }
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "无法读取元数据文件。");
    } finally {
      if (mounted.current) setLoading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function cover(file?: File) {
    if (!file) return;
    setLoading(true);
    setError("");
    try {
      const data = await blobToCoverDataURL(file);
      if (mounted.current) edit({ coverDataUrl: data });
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "无法读取图片。");
    } finally {
      if (mounted.current) setLoading(false);
      if (coverInput.current) coverInput.current.value = "";
    }
  }
  async function confirm() {
    if (!value || disabled) return;
    if (!value.album.title.trim() || !value.album.artist.trim()) {
      setError("请填写专辑名称和音乐人后继续。");
      return;
    }
    if (duplicates.length && !duplicateConfirmed) {
      setError("找到可能重复的作品，请打开原记录，或勾选“另建一条独立记录”。");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await onConfirm(value);
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "无法创建作品，请重试。");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }
  return (
    <div className="album-import-panel" aria-busy={loading}>
      {!value ? (
        <>
          <label htmlFor="album-link">专辑链接</label>
          <form
            className="import-link-form"
            onSubmit={(e) => {
              e.preventDefault();
              fetchInfo();
            }}
          >
            <input
              id="album-link"
              type="text"
              inputMode="url"
              autoFocus
              placeholder="粘贴网易云、QQ 或 Apple Music 专辑链接"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={disabled}
            />
            <button
              type="submit"
              className="button primary"
              disabled={disabled || !url.trim() || available !== true}
            >
              {loading ? <LoaderCircle className="spinning" size={16} /> : null}
              获取信息
            </button>
          </form>
          {available === false && (
            <p className="import-help">
              当前页面没有本地采集服务。可导入工具生成的
              JSON，或手动添加。在线版不会连接你电脑上的服务。
            </p>
          )}
          {available === null && (
            <p className="import-help">正在检查本地导入服务…</p>
          )}
          <div className="import-alternatives">
            <button
              className="button secondary"
              disabled={disabled}
              onClick={() => fileInput.current?.click()}
            >
              导入元数据 JSON
            </button>
            <button
              className="quiet-link"
              onClick={onManual}
              disabled={disabled}
            >
              改为手动添加
              <ArrowRight size={14} />
            </button>
          </div>
          <details className="import-instructions">
            <summary>本地启动与 JSON 工具</summary>
            <p>
              在项目文件夹运行 <code>npm run local</code>
              ，从终端显示的本机地址打开网页即可直接导入。
            </p>
            <p>使用在线版时，可先运行以下命令，再选择上方“导入元数据 JSON”。</p>
            <pre>python3 -m tools.album_import '专辑链接' -o album.json</pre>
            <p>不需要 Spotify 订阅、API 密钥或数据库服务器。</p>
          </details>
        </>
      ) : (
        <>
          <p className="import-reference">
            资料来源：{IMPORT_PROVIDER_LABELS[value.source.provider]}
          </p>
          <div className="import-preview-head">
            <div className="import-cover">
              <button
                disabled={disabled}
                aria-label="更换导入封面"
                onClick={() => coverInput.current?.click()}
              >
                {value.album.coverDataUrl ? (
                  <img src={value.album.coverDataUrl} alt="导入专辑封面" />
                ) : (
                  <span>上传封面</span>
                )}
              </button>
              <input
                ref={coverInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => cover(e.target.files?.[0])}
              />
            </div>
            <div className="import-fields">
              <label>
                专辑名称
                <input
                  aria-label="导入专辑名称"
                  value={value.album.title}
                  disabled={disabled}
                  onChange={(e) => edit({ title: e.target.value })}
                />
              </label>
              <label>
                音乐人
                <input
                  aria-label="导入音乐人"
                  value={value.album.artist}
                  disabled={disabled}
                  onChange={(e) => edit({ artist: e.target.value })}
                />
              </label>
              <div className="import-meta">
                <label>
                  年份
                  <input
                    aria-label="导入发行年份"
                    value={value.album.year}
                    inputMode="numeric"
                    disabled={disabled}
                    onChange={(e) => edit({ year: e.target.value })}
                  />
                </label>
                <label>
                  发行形式
                  <select
                    aria-label="导入发行形式"
                    value={value.album.releaseType ?? ""}
                    disabled={disabled}
                    onChange={(e) =>
                      edit({
                        releaseType: e.target.value
                          ? (e.target.value as AlbumMetadata["releaseType"])
                          : null,
                      })
                    }
                  >
                    <option value="">待确认</option>
                    <option value="album">Album</option>
                    <option value="ep">EP</option>
                    <option value="single">Single</option>
                  </select>
                </label>
              </div>
            </div>
          </div>
          {!!value.warnings.length && (
            <div className="import-warnings">
              {value.warnings.map((warning, i) => (
                <p key={i}>{warning}</p>
              ))}
            </div>
          )}
          {!!value.album.referenceGenres.length && (
            <p className="import-reference">
              参考标签：{value.album.referenceGenres.join("、")}
              。下一步请自行选择 MUMAKA 风格。
            </p>
          )}
          <details className="import-track-details" open>
            <summary>确认曲目 · {value.album.tracks.length} 首</summary>
            <div className="import-track-list">
              {value.album.tracks.map((t, i) => (
                <div className="import-track" key={i}>
                  <span>{i + 1}</span>
                  <input
                    aria-label={`导入曲目 ${i + 1} 名称`}
                    value={t.title}
                    disabled={disabled}
                    onChange={(e) =>
                      edit({
                        tracks: value.album.tracks.map((track, n) =>
                          n === i ? { ...track, title: e.target.value } : track,
                        ),
                      })
                    }
                  />
                  <button
                    aria-label={`删除导入曲目 ${i + 1}`}
                    className="icon-button"
                    disabled={disabled}
                    onClick={() =>
                      edit({
                        tracks: value.album.tracks
                          .filter((_, n) => n !== i)
                          .map((track, n) => ({ ...track, position: n + 1 })),
                      })
                    }
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              className="quiet-link"
              disabled={disabled}
              onClick={() =>
                edit({
                  tracks: [
                    ...value.album.tracks,
                    {
                      position: value.album.tracks.length + 1,
                      title: "",
                      duration: null,
                    },
                  ],
                })
              }
            >
              <Plus size={14} />
              补充曲目
            </button>
          </details>
          {!!duplicates.length && (
            <section className="import-duplicates" aria-label="可能重复的作品">
              <h3>这张专辑可能已经在作品库中</h3>
              {duplicates.map((a) => (
                <button
                  key={a.id}
                  className="duplicate-record"
                  disabled={disabled}
                  onClick={() => onOpen(a)}
                >
                  <span>
                    {a.title} · {a.artist}
                  </span>
                  打开原记录
                  <ArrowRight size={14} />
                </button>
              ))}
              <label className="check-label">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={duplicateConfirmed}
                  onChange={(e) => setDuplicateConfirmed(e.target.checked)}
                />
                另建一条独立记录
              </label>
            </section>
          )}
          <div className="import-actions">
            <button
              className="quiet-link"
              disabled={disabled}
              onClick={() => {
                setValue(null);
                setError("");
              }}
            >
              重新导入
            </button>
            <button
              className="button primary"
              disabled={disabled}
              onClick={confirm}
            >
              确认并继续
              <ArrowRight size={16} />
            </button>
          </div>
        </>
      )}
      <input
        type="file"
        accept="application/json,.json"
        ref={fileInput}
        aria-label="导入专辑元数据文件"
        hidden
        onChange={(e) => readFile(e.target.files?.[0])}
      />
      {error && (
        <p className="import-error" role="alert">
          {error}
        </p>
      )}
      {loading && (
        <button className="quiet-link" onClick={() => active.current?.abort()}>
          停止获取
        </button>
      )}
    </div>
  );
}
