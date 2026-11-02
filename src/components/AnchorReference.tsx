import { useEffect, useState } from "react";
import { bundledCatalog, anchorIssues } from "../model/v040/catalog";
import { state } from "../lib/v040Storage";
import { CATEGORY_LABELS, NAMES, type Category } from "../model/v040/types";
import "./dual.css";

export function AnchorReference() {
  const [catalog, setCatalog] = useState(bundledCatalog),
    [category, setCategory] = useState<Category>("song");
  const [region, setRegion] = useState<"china" | "global">("china"),
    [dimension, setDimension] = useState("");
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
  const cells = catalog.anchors.filter(
    (a) => a.region === region && a.category === category,
  );
  const pending = cells.filter((a) => !a.artist || a.unassigned).length;
  return (
    <main className="dual-workspace reference-page">
      <div className="dual-heading">
        <div>
          <p className="dual-eyebrow">MUMAKA · REFERENCE</p>
          <h1>星级标尺参考</h1>
          <p>整碟对应维度的比较起点。四组各42格；2.0—5.0星七档。</p>
        </div>
        <span className="dual-badge">候选资料 · 尚未审定</span>
      </div>
      <div className="dual-toolbar">
        <div className="dual-segment" role="group" aria-label="参考地区">
          {(["china", "global"] as const).map((r) => (
            <button
              key={r}
              aria-pressed={region === r}
              onClick={() => setRegion(r)}
            >
              {r === "china" ? "中国" : "国际"}
            </button>
          ))}
        </div>
        <div className="dual-segment" role="group" aria-label="参考类别">
          {(["song", "instrumental"] as const).map((c) => (
            <button
              key={c}
              aria-pressed={category === c}
              onClick={() => {
                setCategory(c);
                setDimension("");
              }}
            >
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
        <label>
          查看维度
          <select
            aria-label="参考维度"
            value={dimension}
            onChange={(e) => setDimension(e.target.value)}
          >
            <option value="">全部六维</option>
            {NAMES[category].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="dual-note" role="status">
        当前42格：{42 - pending}个具名候选，{pending}格待选，
        {cells.filter((a) => a.approved).length}格审定。
        {region === "china" && category === "song"
          ? "优先使用华语歌曲R3：39位主艺人各一次；制作2.5、制作3.0、愿景3.0待选。"
          : "原V0.38.1候选保留；艺人重复或整碟证据不足的格位均标记待审。"}
        <br />
        同维七档不得重复艺人；同表最多3次，优先一次。0.5—1.5星仍可实际评分，此处不设置专辑锚点。
      </div>
      <div className="reference-dimensions">
        {NAMES[category]
          .filter((n) => !dimension || dimension === n)
          .map((name) => (
            <section className="reference-dimension" key={name}>
              <h2>
                {name}
                <small>七档比较</small>
              </h2>
              {cells
                .filter((a) => a.dimension === name)
                .sort((a, b) => b.stars - a.stars)
                .map((a) => (
                  <article
                    className="anchor-cell"
                    key={a.id}
                    data-anchor-id={a.id}
                  >
                    <div className="anchor-heading">
                      <b>
                        {a.stars.toFixed(1)}
                        <small> ★</small>
                      </b>
                      <div>
                        <h3>
                          {a.unassigned || !a.artist ? "待选格位" : a.album}
                        </h3>
                        <span>
                          {a.artist || "尚无合适候选"}
                          {a.year ? ` · ${a.year}` : ""}
                        </span>
                      </div>
                    </div>
                    <p>{a.feature}</p>
                    <div className="anchor-flags">
                      {anchorIssues(a, catalog.anchors).map((issue) => (
                        <span key={issue}>{issue}</span>
                      ))}
                    </div>
                    <details>
                      <summary>整碟特征、半星差别与审核</summary>
                      <p>
                        <b>当前状态：</b>
                        {a.status} · {a.listening}
                      </p>
                      <p>
                        <b>版本：</b>
                        {a.version} · {a.sourceSheet} 第{a.sourceRow}行
                      </p>
                      {a.edition && (
                        <p>
                          <b>录音版本：</b>
                          {a.edition}
                        </p>
                      )}
                      <p>
                        <b>档位边界：</b>
                        {a.standard}
                      </p>
                      <p>
                        <b>应评：</b>
                        {a.include}
                      </p>
                      <p>
                        <b>排除：</b>
                        {a.exclude}
                      </p>
                      {a.evidence && (
                        <p>
                          <b>跨曲线索（待试听）：</b>
                          {a.evidence}
                        </p>
                      )}
                      {a.auditExtent && (
                        <p>
                          <b>核验范围：</b>
                          {a.auditExtent}
                        </p>
                      )}
                      <p>
                        <b>低半星：</b>
                        {a.lower}
                      </p>
                      <p>
                        <b>高半星：</b>
                        {a.upper}
                      </p>
                      <p>
                        <b>比较问题：</b>
                        {a.comparison}
                      </p>
                      <p>
                        <b>风险与反例：</b>
                        {a.risk}
                      </p>
                      {a.pending && (
                        <p>
                          <b>待完成：</b>
                          {a.pending}
                        </p>
                      )}
                      {a.sourceText && (
                        <details>
                          <summary>资料来源与读取范围</summary>
                          <p className="preserve-lines">{a.sourceText}</p>
                          {[
                            ...new Set(
                              a.sourceText.match(/https?:\/\/[^\s]+/g) ?? [],
                            ),
                          ].map((url, i) => (
                            <a
                              key={url}
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              来源 {i + 1}　
                            </a>
                          ))}
                        </details>
                      )}
                    </details>
                  </article>
                ))}
            </section>
          ))}
      </div>
      <p className="dual-source">
        来源 {catalog.sourceVersion} · SHA-256 {catalog.sourceSha256}
        。候选事实与半星研究判断分开，资料页不影响评分公式。
      </p>
    </main>
  );
}
