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
import { normalizeArtist, auditReferences } from "../lib/referenceAudit";
import { manualSnapshot } from "../lib/referenceReview";

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
        workId: a.workId || `album:${normalizeArtist(a.artist)}:${normalizeArtist(a.album)}:${a.year}`,
        primaryArtistId: a.primaryArtistId || `artist:${normalizeArtist(a.artist)}`,
        confidence: a.confidence || "low",
        evidence: a.evidence || "升级前的本机记录；本轮证据尚待补核。",
        edition: a.edition || "升级前的本机版本，具体发行待核",
        mainGenre: mainGenre(a),
        displayStandard:
          a.displayStandard || levelStandard(a.category, a.dimension, a.stars),
      });
    setUnlocked(false);
    setListened(false);
  }, [catalog, id]);
  const original = catalog.anchors.find((a) => a.id === id),
    selected = REFERENCE_GROUPS[group];
  const protectedCell = !!(original?.approved || original?.manualLocked);
  const locked = protectedCell && !unlocked;
  const update = (key: keyof Anchor, value: unknown) =>
    setEdit((a) => {
      if (!a) return a;
      const next = {
            ...a,
            [key]: value,
            approved: key === "approved" ? (value as boolean) : false,
          };
      if (["album", "artist", "year"].includes(key)) {
        next.primaryArtistId = `artist:${normalizeArtist(next.artist)}`;
        next.workId = `album:${normalizeArtist(next.artist)}:${normalizeArtist(next.album)}:${next.year}`;
      }
      return next;
    });
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
      <p>四类共168格。人工选片与已审定格均受保护；本机修订进入完整备份，原始截图版独立保留。</p>
      <details>
        <summary>人工底稿与全表校验</summary>
        <p>{manualSnapshot.version} · 23个人工位置、19个原始空格。补全候选不写回底稿。</p>
        <button className="quiet-link" onClick={() => {
          const blob = new Blob([JSON.stringify(manualSnapshot, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob), link = document.createElement("a");
          link.href = url; link.download = `${manualSnapshot.version}.json`; link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>导出原始人工底稿</button>
        <p>同维七位不同主艺人；每表最多一位艺人出现两次，同一专辑不可重复占格。</p>
        <p>{auditReferences(referenceAnchors(catalog)).filter(i => i.severity === "error").length === 0 ? "四表结构与去重校验通过。艺术定位仍须整碟人工审定。" : "存在待处理的格位约束，请检查下方资料。"}</p>
      </details>
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
      {protectedCell && (
        <p>
          {original?.manualLocked ? "此格为人工选片；原图与原始文字受独立版本保护。" : "此格已审定。"}
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
          <label>封面出处页<input aria-label="参考封面出处" value={edit.coverSource || ""} onChange={e => update("coverSource", e.target.value)} /></label>
          <label>封面版权与用途<input aria-label="参考封面版权" value={edit.coverLicense || ""} onChange={e => update("coverLicense", e.target.value)} /></label>
          <label>采用的发行版本<input aria-label="参考发行版本" value={edit.edition || ""} onChange={e => update("edition", e.target.value)} /></label>
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
          <p>资料信心：{edit.confidence}。{edit.identityNote}</p>
          <p>{edit.evidence}</p>
          {edit.manualTitle && <p>原始人工文字：{edit.manualTitle} · {edit.manualVersion}</p>}
          {anchorIssues(edit, referenceAnchors(catalog)).map((issue) => (
            <p key={issue}>{issue}</p>
          ))}
          <p>{edit.sourceText}</p>
        </details>
      )}
    </details>
  );
}
