import { useEffect, useState } from "react";
import { bundledCatalog, anchorIssues } from "../model/v040/catalog";
import { state, saveReferenceCandidate } from "../lib/v040Storage";
import { referenceAnchors } from "../lib/referenceCatalog";
import {
  REFERENCE_GROUPS,
  levelStandard,
  mainGenre,
} from "../lib/referencePresentation";
import type { Anchor } from "../model/v040/types";

export function ReferenceManager() {
  const [catalog, setCatalog] = useState(bundledCatalog),
    [group, setGroup] = useState(0),
    [id, setId] = useState(bundledCatalog.anchors[0].id);
  const [edit, setEdit] = useState<Anchor | null>(null),
    [unlocked, setUnlocked] = useState(false),
    [listened, setListened] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    state()
      .then((s) => setCatalog(s.catalog))
      .catch((e) => setNotice(String(e)));
  }, []);
  useEffect(() => {
    const a = referenceAnchors(catalog).find((a) => a.id === id);
    if (a)
      setEdit({
        ...a,
        mainGenre: mainGenre(a),
        displayStandard:
          a.displayStandard || levelStandard(a.category, a.dimension, a.stars),
      });
    setUnlocked(false);
    setListened(false);
  }, [catalog, id]);
  const original = catalog.anchors.find((a) => a.id === id),
    selected = REFERENCE_GROUPS[group];
  const locked = !!original?.approved && !unlocked;
  const update = (key: keyof Anchor, value: unknown) =>
    setEdit((a) =>
      a
        ? {
            ...a,
            [key]: value,
            approved: key === "approved" ? (value as boolean) : false,
          }
        : a,
    );
  async function save() {
    if (!edit || !original) return;
    setBusy(true);
    setNotice("");
    try {
      const next = await saveReferenceCandidate(
        edit,
        original,
        unlocked,
        listened,
      );
      setCatalog(next);
      setNotice("参考已保存在本机；首页和完整标尺同步使用，历史评分保持原样。");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="dual-panel reference-manager">
      <summary>管理标尺候选</summary>
      <p>四类共168格。编辑和审定保存在本机完整备份中；已审定格需先解除保护。</p>
      <div className="dual-field-row">
        <label>
          参考分类
          <select
            aria-label="管理参考分类"
            value={group}
            onChange={(e) => {
              const g = Number(e.target.value);
              setGroup(g);
              const s = REFERENCE_GROUPS[g];
              setId(
                catalog.anchors.find(
                  (a) => a.region === s.region && a.category === s.category,
                )!.id,
              );
            }}
          >
            {REFERENCE_GROUPS.map((g, i) => (
              <option key={g.id} value={i}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          格位
          <select
            aria-label="管理参考格位"
            value={id}
            onChange={(e) => setId(e.target.value)}
          >
            {catalog.anchors
              .filter(
                (a) =>
                  a.region === selected.region &&
                  a.category === selected.category,
              )
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.dimension} · {a.stars.toFixed(1)} 星 · {a.album || "待选"}
                </option>
              ))}
          </select>
        </label>
      </div>
      {original?.approved && (
        <p>
          此格已审定。
          <button
            className="quiet-link"
            onClick={() => {
              setUnlocked(true);
              update("approved", false);
            }}
          >
            解除此格保护并编辑
          </button>
        </p>
      )}
      {edit && (
        <fieldset disabled={locked || busy} className="reference-edit-fields">
          <div className="dual-field-row">
            <label>
              专辑名
              <input
                aria-label="参考专辑名"
                value={edit.album}
                onChange={(e) => update("album", e.target.value)}
              />
            </label>
            <label>
              艺术家
              <input
                aria-label="参考艺术家"
                value={edit.artist}
                onChange={(e) => update("artist", e.target.value)}
              />
            </label>
          </div>
          <div className="dual-field-row">
            <label>
              年份
              <input
                aria-label="参考年份"
                value={edit.year}
                onChange={(e) => update("year", e.target.value)}
              />
            </label>
            <label>
              主风格
              <input
                aria-label="参考主风格"
                value={edit.mainGenre || ""}
                onChange={(e) => update("mainGenre", e.target.value)}
              />
            </label>
          </div>
          <label>
            标准一句
            <textarea
              aria-label="参考标准"
              value={edit.displayStandard || ""}
              onChange={(e) => update("displayStandard", e.target.value)}
            />
          </label>
          <label>
            简明理由
            <textarea
              aria-label="参考理由"
              value={edit.feature}
              onChange={(e) => update("feature", e.target.value)}
            />
          </label>
          <label>
            封面图片地址（可留空）
            <input
              aria-label="参考封面地址"
              value={edit.coverUrl || ""}
              placeholder="https://"
              onChange={(e) => update("coverUrl", e.target.value)}
            />
          </label>
          <label>
            资料来源（每行一个网址）
            <textarea
              aria-label="参考来源"
              value={edit.sources.join("\n")}
              onChange={(e) =>
                update("sources", e.target.value.split("\n").filter(Boolean))
              }
            />
          </label>
          <label>
            审定人
            <input
              aria-label="参考审定人"
              value={edit.reviewedBy || ""}
              onChange={(e) => update("reviewedBy", e.target.value)}
            />
          </label>
          <label className="dual-checkbox">
            <input
              type="checkbox"
              checked={listened}
              onChange={(e) => setListened(e.target.checked)}
            />
            我已核验完整专辑及这一维度的等级依据
          </label>
          <label className="dual-checkbox">
            <input
              type="checkbox"
              checked={edit.approved}
              disabled={!listened || !edit.reviewedBy?.trim()}
              onChange={(e) => update("approved", e.target.checked)}
            />
            将此格标为已审定
          </label>
          <button className="button primary" onClick={save}>
            保存此格
          </button>
        </fieldset>
      )}
      {notice && <p role="status">{notice}</p>}
      {edit && (
        <details>
          <summary>内部资料与校验</summary>
          <p>
            {edit.status} · {edit.version} · {edit.listening}
          </p>
          <p>{edit.pending}</p>
          {anchorIssues(edit, referenceAnchors(catalog)).map((issue) => (
            <p key={issue}>{issue}</p>
          ))}
          <p>{edit.sourceText}</p>
        </details>
      )}
    </details>
  );
}
