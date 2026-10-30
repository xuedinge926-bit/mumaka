import { useMemo, useState } from "react";
import { ArrowRight, Disc3 } from "lucide-react";
import {
  DIMENSIONS,
  LABELS,
  type Album,
  type Calculation,
  type Snapshot,
} from "../model/types";
import { calculatePrivate } from "../model/privateReview";
import { csvCell, downloadBlob } from "../lib/exports";
import type { Preferences } from "../lib/preferences";

export type WorkbenchTab =
  "library" | "ratings" | "data" | "settings" | "cards";
interface Props {
  albums: Album[];
  snapshots: Snapshot[];
  busy: boolean;
  tab: WorkbenchTab;
  onTab: (tab: WorkbenchTab) => void;
  preferences: Preferences;
  onPreferences: (value: Preferences) => void;
  onOpen: (
    album: Album,
    target?: "confirm" | "rating" | "card",
  ) => Promise<void>;
  onSnapshot: (snapshot: Snapshot) => Promise<void>;
  onCopy: (album: Album) => Promise<void>;
  onDelete: (album: Album) => Promise<void>;
  onManual: () => void;
  onImport: () => void;
  onBackup: () => Promise<void>;
  onRestore: () => void;
}
const TABS: Record<WorkbenchTab, string> = {
  library: "作品库",
  ratings: "评分记录",
  data: "数据管理",
  settings: "设置",
  cards: "卡片工具",
};
const date = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(new Date(value));

/** Published rows always use a matching frozen result; missing history never gets recalculated. */
export function libraryCalculation(
  album: Album,
  snapshots: Snapshot[],
): Calculation | null {
  if (album.status === "published")
    return (
      snapshots.find(
        (s) =>
          s.albumId === album.id &&
          s.kind === "published" &&
          s.album.revision === album.revision &&
          s.album.updatedAt === album.updatedAt,
      )?.calculation ?? null
    );
  return calculatePrivate(album);
}

export function Workbench(props: Props) {
  const { albums, snapshots, busy, tab, onTab } = props;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("updated");
  const [status, setStatus] = useState("all");
  const visible = useMemo(
    () =>
      albums
        .filter((a) =>
          `${a.title} ${a.artist} ${a.year}`
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()),
        )
        .filter(
          (a) =>
            status === "all" ||
            (status === "published"
              ? a.status === "published"
              : a.status !== "published"),
        )
        .sort((a, b) =>
          sort === "title"
            ? a.title.localeCompare(b.title, "zh-CN")
            : sort === "artist"
              ? a.artist.localeCompare(b.artist, "zh-CN")
              : b.updatedAt.localeCompare(a.updatedAt),
        ),
    [albums, query, sort, status],
  );
  const results = useMemo(
    () => new Map(albums.map((a) => [a.id, libraryCalculation(a, snapshots)])),
    [albums, snapshots],
  );
  function csv() {
    const rows: unknown[][] = [
      [
        "专辑",
        "音乐人",
        "年份",
        "类型",
        "记录状态",
        "总分",
        "评分更新时间",
        ...DIMENSIONS.map((d) => LABELS[d]),
      ],
      ...albums.map((a) => [
        a.title,
        a.artist,
        a.year,
        a.kind,
        a.status === "published" ? "已发表" : "私人草稿",
        results.get(a.id)?.total ?? "",
        a.updatedAt,
        ...DIMENSIONS.map((d) =>
          a.ratings[d].value === "na" ? "N/A" : (a.ratings[d].value ?? ""),
        ),
      ]),
    ];
    downloadBlob(
      new Blob(
        ["\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n")],
        { type: "text/csv;charset=utf-8" },
      ),
      "MUMAKA-作品库.csv",
    );
  }
  return (
    <main className="workbench-layout">
      <aside className="workbench-sidebar">
        <h1>专业工作台</h1>
        <nav aria-label="工作台导航">
          {(Object.keys(TABS) as WorkbenchTab[]).map((key) => (
            <button
              key={key}
              aria-current={key === tab ? "page" : undefined}
              onClick={() => onTab(key)}
            >
              {TABS[key]}
            </button>
          ))}
        </nav>
        <button className="quiet-link" onClick={props.onManual} disabled={busy}>
          新建评分
          <ArrowRight size={14} />
        </button>
      </aside>
      <section className="workbench-content" aria-label={TABS[tab]}>
        <div className="workbench-heading">
          <div>
            <p>MUMAKA / 木马卡</p>
            <h2>{TABS[tab]}</h2>
          </div>
          {tab === "library" && (
            <div className="workbench-actions">
              <button
                className="button secondary small"
                disabled={busy}
                onClick={props.onImport}
              >
                通过链接添加
              </button>
              <button
                className="button primary small"
                disabled={busy}
                onClick={props.onManual}
              >
                添加作品
              </button>
            </div>
          )}
        </div>
        {tab === "library" && (
          <>
            <div className="library-filters">
              <input
                type="search"
                aria-label="搜索作品库"
                placeholder="搜索专辑、音乐人或年份"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <select
                aria-label="作品排序"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="updated">最近编辑</option>
                <option value="title">专辑名称</option>
                <option value="artist">音乐人</option>
              </select>
              <select
                aria-label="作品筛选"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">全部作品</option>
                <option value="draft">私人草稿</option>
                <option value="published">已发表历史</option>
              </select>
            </div>
            <p className="library-count">{visible.length} 张作品</p>
            <div className="library-list">
              {visible.map((a) => (
                <article className="library-row" key={a.id}>
                  <button
                    className="library-album"
                    onClick={() => props.onOpen(a)}
                    disabled={busy}
                  >
                    <div className="recent-cover">
                      {a.cover ? (
                        <img src={a.cover} alt="" />
                      ) : (
                        <Disc3 size={22} />
                      )}
                    </div>
                    <span>
                      <b>{a.title || "未命名专辑"}</b>
                      <small>
                        {a.artist || "未填写音乐人"}
                        {a.year ? ` · ${a.year}` : ""}
                      </small>
                      <small>
                        {a.status === "published"
                          ? "已发表历史"
                          : results.get(a.id)?.total
                            ? "已评分"
                            : "草稿"}{" "}
                        · {date(a.updatedAt)}
                      </small>
                    </span>
                  </button>
                  <strong className="library-score">
                    {results.get(a.id)?.total ?? "—"}
                  </strong>
                  <div className="library-row-actions">
                    <button disabled={busy} onClick={() => props.onOpen(a)}>
                      打开
                    </button>
                    <button disabled={busy} onClick={() => props.onCopy(a)}>
                      复制
                    </button>
                    {a.status !== "published" && (
                      <button disabled={busy} onClick={() => props.onDelete(a)}>
                        删除
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
            {!visible.length && (
              <p className="quiet-message">
                {albums.length
                  ? "没有匹配的作品。"
                  : "作品库还没有专辑。可以通过链接导入，也可以手动添加。"}
              </p>
            )}
          </>
        )}
        {tab === "ratings" && (
          <div className="rating-records">
            {snapshots.length ? (
              snapshots.map((s) => (
                <button
                  key={s.id}
                  className="rating-record"
                  onClick={() => props.onSnapshot(s)}
                  disabled={busy}
                >
                  <span>
                    <b>{s.album.title || "未命名专辑"}</b>
                    <small>
                      {s.album.artist} · {date(s.createdAt)} ·{" "}
                      {s.kind === "published" ? "已发表历史" : "已保存版本"}
                    </small>
                    <span className="record-dimensions">
                      {DIMENSIONS.map((d) => (
                        <span key={d}>
                          {LABELS[d]}{" "}
                          {s.album.ratings[d].value === "na"
                            ? "N/A"
                            : (s.album.ratings[d].value ?? "—")}
                        </span>
                      ))}
                    </span>
                  </span>
                  <strong>{s.calculation.total ?? "—"}</strong>
                  <ArrowRight size={16} />
                </button>
              ))
            ) : (
              <p className="quiet-message">
                生成评分卡时会保存一份评分版本。修改草稿不会覆盖这些记录。
              </p>
            )}
          </div>
        )}
        {tab === "data" && (
          <div className="workbench-panel">
            <h3>备份与恢复</h3>
            <p>
              完整 JSON
              备份包含作品、封面与历史评分。恢复时遇到冲突会提示，不会覆盖已有内容。
            </p>
            <div className="settings-buttons">
              <button
                className="button primary"
                disabled={busy}
                onClick={props.onBackup}
              >
                导出全部备份
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={props.onRestore}
              >
                导入备份
              </button>
            </div>
            <h3>作品库表格</h3>
            <p>CSV 用于查阅与整理；需要恢复完整数据时请使用 JSON 备份。</p>
            <button
              className="button secondary"
              disabled={busy || !albums.length}
              onClick={csv}
            >
              导出作品库 CSV
            </button>
          </div>
        )}
        {tab === "settings" && (
          <div className="workbench-panel preference-fields">
            <h3>新作品偏好</h3>
            <p>只应用于之后创建的作品，已有记录保持原样。</p>
            <label>
              默认导出比例
              <select
                aria-label="默认导出比例"
                value={props.preferences.cardRatio}
                onChange={(e) =>
                  props.onPreferences({
                    ...props.preferences,
                    cardRatio: e.target.value as Preferences["cardRatio"],
                  })
                }
              >
                <option>4:5</option>
                <option>3:4</option>
                <option>1:1</option>
              </select>
            </label>
            <label>
              常用风格排序
              <select
                aria-label="默认风格推荐地区"
                value={props.preferences.market}
                onChange={(e) =>
                  props.onPreferences({
                    ...props.preferences,
                    market: e.target.value as Preferences["market"],
                  })
                }
              >
                <option value="china">中国</option>
                <option value="global">其他地区</option>
              </select>
            </label>
            <p>
              本地数据属于当前浏览器。更换设备、浏览器或地址前，请先导出备份。
            </p>
            <button
              className="button secondary"
              disabled={busy}
              onClick={props.onBackup}
            >
              导出全部备份
            </button>
          </div>
        )}
        {tab === "cards" && (
          <div className="workbench-panel">
            <p>
              选择作品，使用现有评分卡预览与导出。尚未完成的作品会进入资料确认页。
            </p>
            {albums.length ? (
              albums.map((a) => (
                <button
                  key={a.id}
                  className="history-item"
                  disabled={busy}
                  onClick={() =>
                    props.onOpen(
                      a,
                      results.get(a.id)?.total ? "card" : "confirm",
                    )
                  }
                >
                  <span>
                    <b>{a.title || "未命名专辑"}</b>
                    <small>{a.artist}</small>
                  </span>
                  <strong>{results.get(a.id)?.total ?? "未完成"}</strong>
                  <ArrowRight size={16} />
                </button>
              ))
            ) : (
              <p className="quiet-message">请先创建一张专辑。</p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
