import { useEffect, useState } from "react";
import { Disc3 } from "lucide-react";
import { bundledCatalog } from "../model/v040/catalog";
import { state } from "../lib/v040Storage";
import { referenceAnchors } from "../lib/referenceCatalog";
import {
  REFERENCE_GROUPS,
  REFERENCE_STARS,
  levelStandard,
  anchorReason,
  mainGenre,
  safeCover,
} from "../lib/referencePresentation";
import { NAMES, type Anchor } from "../model/v040/types";
import "./dual.css";

function ReferenceCover({ anchor }: { anchor: Anchor }) {
  const [failed, setFailed] = useState(false),
    url = safeCover(anchor.coverUrl);
  return (
    <div
      className="reference-cover"
      aria-label={url && !failed ? undefined : "暂无封面"}
    >
      {url && !failed ? (
        <img
          src={url}
          loading="lazy"
          alt={`${anchor.album}封面`}
          onError={() => setFailed(true)}
        />
      ) : (
        <Disc3 size={24} strokeWidth={1} />
      )}
    </div>
  );
}
export function AnchorReference({
  compact = false,
  expanded = false,
  onFull,
}: {
  compact?: boolean;
  expanded?: boolean;
  onFull?: () => void;
}) {
  const [catalog, setCatalog] = useState(bundledCatalog),
    [group, setGroup] = useState(0),
    [dimension, setDimension] = useState("");
  const [showMore, setShowMore] = useState(false);
  useEffect(() => {
    let canceled = false;
    state()
      .then((s) => {
        if (!canceled) setCatalog(s.catalog);
      })
      .catch(() => undefined);
    return () => {
      canceled = true;
    };
  }, []);
  const selected = REFERENCE_GROUPS[group],
    cells = referenceAnchors(catalog).filter(
      (a) => a.region === selected.region && a.category === selected.category,
    );
  const names = NAMES[selected.category].filter(
    (n) => !dimension || dimension === n,
  );
  const display = compact && !showMore ? names.slice(0, 2) : names;
  const body = (
    <>
      <div className="reference-title">
        <div>
          {!compact && <p className="dual-eyebrow">REFERENCE</p>}
          {compact ? <h2>星级标尺速览</h2> : <h1>星级标尺参考</h1>}
          <p>六个维度，七档参照。从标准读起，再对照一张完整专辑。</p>
        </div>
        {compact && (
          <button className="quiet-link" onClick={onFull}>
            打开完整标尺 →
          </button>
        )}
      </div>
      <div className="reference-tabs" role="tablist" aria-label="四类星级参考">
        {REFERENCE_GROUPS.map((g, i) => (
          <button
            role="tab"
            key={g.id}
            id={`${compact ? "overview" : "reference"}-${g.id}`}
            aria-selected={group === i}
            aria-controls={`${compact ? "overview" : "reference"}-grid`}
            tabIndex={group === i ? 0 : -1}
            onClick={() => {
              setGroup(i);
              setDimension("");
            }}
            onKeyDown={(e) => {
              if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                const next =
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? 3
                      : (group + (e.key === "ArrowRight" ? 1 : 3)) % 4;
                setGroup(next);
                setDimension("");
                document
                  .getElementById(
                    `${compact ? "overview" : "reference"}-${REFERENCE_GROUPS[next].id}`,
                  )
                  ?.focus();
              }
            }}
          >
            {g.label}
          </button>
        ))}
      </div>
      <div className="reference-meta">
        <p>
          候选参考，尚未完成整碟审定。2.0–5.0 星各七档；0.5–1.5 星仍可评分。
        </p>
        {!compact && (
          <label>
            查看维度
            <select
              aria-label="参考维度"
              value={dimension}
              onChange={(e) => setDimension(e.target.value)}
            >
              <option value="">全部六维</option>
              {NAMES[selected.category].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div
        id={`${compact ? "overview" : "reference"}-grid`}
        className="reference-grid-scroll"
        role="tabpanel"
        tabIndex={0}
        aria-label="可横向滚动的六维七档对照表"
        aria-labelledby={`${compact ? "overview" : "reference"}-${selected.id}`}
      >
        <table className="reference-grid">
          <thead>
            <tr>
              <th scope="col">维度</th>
              {REFERENCE_STARS.map((s) => (
                <th scope="col" key={s}>
                  {s.toFixed(1)} <span aria-hidden="true">★</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {display.map((name) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                {REFERENCE_STARS.map((stars) => {
                  const a = cells.find(
                    (a) => a.dimension === name && a.stars === stars,
                  )!;
                  return (
                    <td key={a.id}>
                      <article className="anchor-cell" data-anchor-id={a.id}>
                        <p className="anchor-standard">
                          {a.displayStandard ||
                            levelStandard(selected.category, name, stars)}
                        </p>
                        <div className="anchor-album">
                          <ReferenceCover
                            key={`${a.id}-${a.coverUrl}`}
                            anchor={a}
                          />
                          <div>
                            <h3>
                              {a.unassigned || !a.artist ? "待选专辑" : a.album}
                            </h3>
                            <p>
                              {a.artist || "待确认"}
                              {a.year && ` · ${a.year}`}
                            </p>
                            <small>{mainGenre(a)}</small>
                            {a.status === "discussion" && <small className="reference-discussion">人工位置 · 待商议</small>}
                            {a.coverSource && safeCover(a.coverSource) && <a className="reference-cover-credit" href={a.coverSource} target="_blank" rel="noreferrer">封面出处</a>}
                          </div>
                        </div>
                        <details open={expanded || undefined}>
                          <summary>为何作参照</summary>
                          <p>
                            {anchorReason(a) || "此格尚待选择合适的完整专辑。"}
                          </p>
                        </details>
                      </article>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {compact && (
        <button
          className="reference-expand quiet-link"
          aria-expanded={showMore}
          onClick={() => setShowMore(!showMore)}
        >
          {showMore ? "收起为两维速览" : "展开全部六维"}
        </button>
      )}
    </>
  );
  return compact ? (
    <section className="reference-overview">{body}</section>
  ) : (
    <main className="dual-workspace reference-page">{body}</main>
  );
}
