import { Plus, Trash2 } from "lucide-react";
import { createId } from "../lib/browserCrypto";
import { durationWeightedFirst } from "../model/v035/math";
import { type ResearchDraft, type FirstUnit } from "../model/v035/types";
import { StarRating } from "./StarRating";

export function ResearchFirstUnits({
  draft,
  disabled,
  onChange,
}: {
  draft: ResearchDraft;
  disabled: boolean;
  onChange: (patch: Partial<ResearchDraft>) => void;
}) {
  let advice: ReturnType<typeof durationWeightedFirst> | null = null;
  try {
    advice = durationWeightedFirst(draft.firstUnits);
  } catch {
    /* An incomplete unit remains an editable draft. */
  }
  function units(next: FirstUnit[]) {
    onChange({ firstUnits: next, midpointReviewed: false });
  }
  function patch(id: string, value: Partial<FirstUnit>) {
    units(draft.firstUnits.map((u) => (u.id === id ? { ...u, ...value } : u)));
  }
  function add() {
    units([
      ...draft.firstUnits,
      {
        id: createId(),
        trackId: "",
        title: "",
        durationMs: 0,
        mode: "lyrics",
        ratingTicks: null,
        evidence: "",
      },
    ]);
  }
  return (
    <section className="research-mixed" aria-label="混合专辑首维参考">
      <h3>分曲／独立乐段的首维参考</h3>
      <p className="research-muted">
        记录承担独立审美任务的整首曲目或乐段。长间奏不因无人演唱自动拆分；未知语言的语义歌词仍属
        Lyrics。时长参考只用于第一维，其他五维按整碟评分。
      </p>
      <div className="research-actions">
        <button
          className="button secondary small"
          disabled={disabled}
          onClick={add}
        >
          <Plus size={14} />
          添加评价单位
        </button>
        {draft.tracks.length > 0 && draft.firstUnits.length === 0 && (
          <button
            className="quiet-link"
            disabled={disabled}
            onClick={() =>
              units(
                draft.tracks.map((t) => ({
                  id: createId(),
                  trackId: t.id,
                  title: t.title,
                  durationMs: Math.round(t.duration * 1000),
                  mode: "lyrics",
                  ratingTicks: null,
                  evidence: "",
                })),
              )
            }
          >
            从曲目建立空白评价单位
          </button>
        )}
      </div>
      {draft.firstUnits.map((u, i) => (
        <div className="research-unit" key={u.id}>
          <div className="research-unit-heading">
            <b>评价单位 {i + 1}</b>
            <button
              className="icon-button"
              aria-label={`删除评价单位${i + 1}`}
              disabled={disabled}
              onClick={() =>
                units(draft.firstUnits.filter((x) => x.id !== u.id))
              }
            >
              <Trash2 size={15} />
            </button>
          </div>
          <div className="research-fields">
            <label>
              曲目／乐段名称
              <input
                aria-label={`单位${i + 1}名称`}
                disabled={disabled}
                value={u.title}
                onChange={(e) => patch(u.id, { title: e.target.value })}
              />
            </label>
            <label>
              对应曲目
              <select
                aria-label={`单位${i + 1}对应曲目`}
                disabled={disabled}
                value={u.trackId}
                onChange={(e) => patch(u.id, { trackId: e.target.value })}
              >
                <option value="">独立录入／乐段</option>
                {draft.tracks.map((t) => (
                  <option value={t.id} key={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              有效时长（秒）
              <input
                aria-label={`单位${i + 1}时长秒`}
                type="number"
                min="0"
                max="86400"
                step="0.001"
                disabled={disabled}
                value={u.durationMs ? u.durationMs / 1000 : ""}
                onChange={(e) =>
                  patch(u.id, {
                    durationMs: Math.round(
                      Math.min(
                        86400,
                        Math.max(0, Number(e.target.value) || 0),
                      ) * 1000,
                    ),
                  })
                }
              />
            </label>
            <label>
              内容判断
              <select
                aria-label={`单位${i + 1}首维模式`}
                disabled={disabled}
                value={u.mode}
                onChange={(e) =>
                  patch(u.id, { mode: e.target.value as FirstUnit["mode"] })
                }
              >
                <option value="lyrics">歌词 / Lyrics</option>
                <option value="expression">表意 / Expression</option>
              </select>
            </label>
          </div>
          <StarRating
            label={`单位${i + 1}首维`}
            value={u.ratingTicks === null ? null : u.ratingTicks / 2}
            disabled={disabled}
            onChange={(v) =>
              patch(u.id, { ratingTicks: v === null ? null : v * 2 })
            }
          />
          <label>
            语义判断与首维证据
            <textarea
              aria-label={`单位${i + 1}证据`}
              disabled={disabled}
              value={u.evidence}
              onChange={(e) => patch(u.id, { evidence: e.target.value })}
            />
          </label>
        </div>
      ))}
      {advice && (
        <div className="research-notice" role="status">
          时长加权参考：
          <b>
            {advice.referenceStars.toLocaleString("zh-CN", {
              maximumFractionDigits: 4,
            })}{" "}
            星
          </b>
          。
          {advice.needsManualMidpointReview
            ? "位于中界±0.05星，必须人工复听复核，未自动给定候选。"
            : `相邻半星参考为 ${advice.candidateTicks! / 2} 星，仍须人工裁定。`}
          <p>此结果不会写入最终第一维星级。</p>
        </div>
      )}
      <label>
        整碟首维人工裁定理由
        <textarea
          aria-label="整碟首维人工裁定理由"
          disabled={disabled}
          value={draft.firstVerdict}
          onChange={(e) =>
            onChange({ firstVerdict: e.target.value, midpointReviewed: false })
          }
        />
      </label>
      {advice?.needsManualMidpointReview && (
        <label className="research-checkbox">
          <input
            type="checkbox"
            aria-label="中界已人工复听复核"
            checked={draft.midpointReviewed}
            disabled={disabled}
            onChange={(e) => onChange({ midpointReviewed: e.target.checked })}
          />
          已针对中界复听，并在上方记录人工裁定理由及最终半星
        </label>
      )}
    </section>
  );
}
