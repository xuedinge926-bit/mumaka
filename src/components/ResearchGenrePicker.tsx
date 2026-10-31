import { useState } from "react";
import { Check, ChevronRight, Search } from "lucide-react";
import {
  families,
  genreById,
  familyById,
  searchGenres,
} from "../model/v035/catalog";
import { DIMENSIONS, labels } from "../model/v035/types";

const CLASSES = {
  independent_candidate: "独立候选",
  general_entry: "一般入口",
  index_only: "索引 · 不计分",
  definition_review: "定义待审",
};
interface Props {
  value?: string;
  override?: boolean;
  disabled?: boolean;
  onChoose?: (id: string, override: boolean) => void;
}
export function ResearchGenrePicker({
  value = "",
  override = false,
  disabled = false,
  onChoose,
}: Props) {
  const [family, setFamily] = useState(genreById.get(value)?.family_id ?? "");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(30);
  const [inspected, setInspected] = useState(value);
  const [researchAllowed, setResearchAllowed] = useState(override);
  const options = searchGenres(query, family),
    selected = genreById.get(inspected || value);
  const parent = selected ? familyById.get(selected.family_id) : undefined;
  function inspect(id: string) {
    setInspected(id);
    setResearchAllowed(id === value ? override : false);
  }
  return (
    <section className="research-genres" aria-label="V0.35分层风格选择器">
      <div className="research-genre-filters">
        <label>
          一级家族 · 34
          <select
            aria-label="研究版一级家族"
            value={family}
            onChange={(e) => {
              setFamily(e.target.value);
              setLimit(30);
            }}
          >
            <option value="">全部家族</option>
            {families.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name_zh} / {f.name_en}
              </option>
            ))}
          </select>
        </label>
        <label>
          搜索二级风格或稳定 ID
          <span className="research-search">
            <Search size={16} />
            <input
              aria-label="研究版搜索风格"
              placeholder="中文、英文、稳定 ID"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(30);
              }}
            />
          </span>
        </label>
      </div>
      <div className="research-genre-columns">
        <div
          className="research-genre-list"
          role="group"
          aria-label="研究版二级风格"
        >
          {!query.trim() && !family ? (
            <p className="quiet-message">
              先选择一级家族，或直接搜索全部565个稳定ID。
            </p>
          ) : (
            <>
              <small>{options.length} 个检索结果（含索引与待定义条目）</small>
              {options.slice(0, limit).map((g) => (
                <button
                  type="button"
                  key={g.id}
                  onClick={() => inspect(g.id)}
                  aria-current={selected?.id === g.id ? "true" : undefined}
                >
                  <span>
                    <b>
                      {g.name_zh} / {g.name_en}
                    </b>
                    <small>{CLASSES[g.classification]}</small>
                  </span>
                  {value === g.id ? (
                    <Check size={15} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                </button>
              ))}
              {!options.length && (
                <p className="quiet-message">没有匹配风格。</p>
              )}
              {limit < options.length && (
                <button
                  className="quiet-link"
                  onClick={() => setLimit((n) => n + 30)}
                >
                  继续显示30项
                </button>
              )}
            </>
          )}
        </div>
        <div className="research-genre-detail" aria-live="polite">
          {selected && parent ? (
            <>
              <div className="research-section-heading">
                <h3>
                  {selected.name_zh} / {selected.name_en}
                </h3>
                <span className="research-badge">
                  {CLASSES[selected.classification]}
                </span>
              </div>
              <code>{selected.id}</code>
              <p className="research-muted">
                {parent.name_zh} / {parent.name_en} · 权重研究候选
              </p>
              <p>{selected.reason}</p>
              {selected.classification === "index_only" ? (
                <div className="research-notice">
                  此项仅作检索索引，没有独立权重。请根据作品选择具体主风格。
                  <p>{selected.mapping_note}</p>
                </div>
              ) : (
                <>
                  <div className="research-table-scroll">
                    <table className="research-weight-table">
                      <caption>一级基准、二级偏移与最终权重（%）</caption>
                      <thead>
                        <tr>
                          <th>维度</th>
                          <th>基准</th>
                          <th>偏移</th>
                          <th>最终</th>
                        </tr>
                      </thead>
                      <tbody>
                        {DIMENSIONS.map((k) => (
                          <tr key={k}>
                            <th>{labels("mixed")[k].zh}</th>
                            <td>{parent.weights_ticks[k] / 2}</td>
                            <td>{(selected.delta_ticks?.[k] ?? 0) / 2}</td>
                            <td>{selected.effective_weight_ticks![k] / 2}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <small>
                    {selected.weight_mode === "family_inherited"
                      ? "继承一级研究基准"
                      : "一级基准加零和偏移"}{" "}
                    · V0.34 research_candidate · 审定未完成
                  </small>
                </>
              )}
              {selected.classification === "definition_review" && (
                <label className="research-checkbox">
                  <input
                    type="checkbox"
                    checked={researchAllowed}
                    disabled={disabled || !onChoose}
                    onChange={(e) => setResearchAllowed(e.target.checked)}
                  />
                  我明确选择研究试算，知悉该风格定义尚待裁定
                </label>
              )}
              {onChoose && (
                <button
                  type="button"
                  className="button secondary small"
                  disabled={
                    disabled ||
                    selected.classification === "index_only" ||
                    (selected.classification === "definition_review" &&
                      !researchAllowed)
                  }
                  onClick={() =>
                    onChoose(
                      selected.id,
                      selected.classification === "definition_review" &&
                        researchAllowed,
                    )
                  }
                >
                  {selected.classification === "index_only"
                    ? "索引不可作为主风格"
                    : selected.classification === "definition_review"
                      ? "用于研究试算"
                      : "设为主风格"}
                </button>
              )}
              <details>
                <summary>来源与复核边界</summary>
                <p>{selected.controversy}</p>
                <p>
                  {selected.recheck_method} · {selected.mapping_note}
                </p>
                <p>
                  原工作簿二级裁定表第{selected.source_row}行；一级证据等级：
                  {parent.evidence_grade}。
                </p>
              </details>
            </>
          ) : (
            <p className="quiet-message">
              选择一个二级条目查看权重、分类与来源。
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
