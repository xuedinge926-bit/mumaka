import { useEffect, useState } from "react";
import { bundledCatalog } from "../model/v040/catalog";
import { CATEGORY_LABELS, NAMES, type Category } from "../model/v040/types";
import { state } from "../lib/v040Storage";
import "./dual.css";

export function DualGenreLibrary({
  onNew,
}: {
  onNew: (category: Category, id: string) => Promise<void>;
}) {
  const [catalog, setCatalog] = useState(bundledCatalog),
    [category, setCategory] = useState<Category>("song"),
    [family, setFamily] = useState(""),
    [query, setQuery] = useState("");
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
  const gs = catalog.genres.filter(
    (g) =>
      (!family || g.familyId === family) &&
      `${g.id} ${g.name} ${g.nameEn}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <main className="dual-workspace">
      <div className="dual-heading">
        <div>
          <p className="dual-eyebrow">GENRES · {catalog.sourceVersion}</p>
          <h1>双体系风格管理</h1>
          <p>34一级 · 565稳定ID · 522候选 · 43索引 · 5定义待审</p>
        </div>
        <div className="dual-segment" role="group" aria-label="风格体系">
          {(["song", "instrumental"] as const).map((c) => (
            <button
              key={c}
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
            >
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
      </div>
      <div className="dual-field-row">
        <label>
          一级家族
          <select
            aria-label="检索一级家族"
            value={family}
            onChange={(e) => setFamily(e.target.value)}
          >
            <option value="">全部34个家族</option>
            {catalog.families.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          检索
          <input
            aria-label="搜索565风格"
            value={query}
            placeholder="中文、英文或稳定ID"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <p className="dual-muted">
        歌曲与乐曲使用来源文件中各自的六维权重。风格目录只读，点击“以此新建”才创建草稿；不改动正在编辑的作品。
      </p>
      <div className="dual-records">
        {gs.map((g) => {
          const p = g.profiles[category];
          return (
            <article key={g.id}>
              <div>
                <b>
                  {g.name} <small>{g.nameEn}</small>
                </b>
                <p>
                  {g.id} · {p.applicability} ·{" "}
                  {g.classification === "definition_review"
                    ? "定义争议待审"
                    : p.reviewStatus}
                </p>
                <small>
                  {NAMES[category]
                    .map(
                      (n, i) =>
                        `${n} ${p.weightsTicks ? `${p.weightsTicks[i] / 2}%` : "—"}`,
                    )
                    .join("　")}
                </small>
                <details>
                  <summary>来源与赋权说明</summary>
                  <p>{p.rationale}</p>
                  <p>
                    {p.source} · {p.sourceSheet} 第{p.sourceRow}行 · 权重{" "}
                    {catalog.weightVersion}
                  </p>
                </details>
              </div>
              <button
                disabled={
                  !p.trialAllowed ||
                  g.classification === "index_only" ||
                  g.classification === "definition_review"
                }
                onClick={() => onNew(category, g.id)}
              >
                以此新建
              </button>
            </article>
          );
        })}
      </div>
    </main>
  );
}
