import chinaSong from "../data/reference-review/china-song.json";
import chinaInstrumental from "../data/reference-review/china-instrumental.json";
import globalSong from "../data/reference-review/global-song.json";
import globalInstrumental from "../data/reference-review/global-instrumental.json";
import manual from "../data/reference-review/manual-2026-11-02.json";
import legacy from "../data/v038";
import additions from "../data/reference-additions.json";
import type { Anchor, Catalog } from "../model/v040/types";

export const REFERENCE_VERSION = "reference-2026-11-02-r1";
export const MANUAL_VERSION = manual.version;
export const manualSnapshot = manual;
const decisions = [...chinaSong, ...chinaInstrumental, ...globalSong, ...globalInstrumental];
const baseline = new Map(legacy.anchors.map(a => [a.id, a]));
const different = (a: Anchor, b: typeof legacy.anchors[number]) =>
  ["album", "artist", "year", "feature"].some(k => a[k as keyof Anchor] !== b[k as keyof typeof b]);

/** A separately versioned selection layer. V0.38 weights and source files stay intact. */
export function currentReferenceAnchors(): Anchor[] {
  return decisions.map((decision) => {
    const original = baseline.get(decision.id);
    if (!original) throw new Error(`未知参考格位：${decision.id}`);
    const a = {
      ...original,
      ...decision,
      version: REFERENCE_VERSION,
      region: original.region,
      category: original.category,
      unassigned: false,
      standard: "本次标尺选片；具体档位标准由六维定义展示。",
      lower: "与低半星参照比较整碟持续性，不把单曲、名望、预算或风格复杂程度直接换算为等级。",
      upper: "与高半星参照双向比较；若本碟多数曲目更符合高档，应提出修订，不为补格压分。",
      comparison: "相邻半星仍需完整专辑核验",
      risk: "资料与发行事实核实不等于完成整碟复听；初稿不是公认客观分数。",
      auditExtent: "在线目录、发行说明及评论线索；未进行完整专辑复听。",
      sourceText: decision.sources.join("\n"),
    } as Anchor;
    return a;
  });
}

export function manualSelectionIssues(anchors: Anchor[]) {
  const issues: string[] = [];
  for (const row of manual.rows)
    row.cells.forEach((title, index) => {
      if (!title) return;
      const a = anchors.find(a => a.region === "china" && a.category === "song" && a.dimension === manual.columns[index] && a.stars === row.stars);
      if (!a || a.manualTitle !== title || a.manualVersion !== MANUAL_VERSION || a.manualLocked !== true)
        issues.push(`${manual.columns[index]} ${row.stars}：原始人工选择或锁定丢失`);
      const selected = chinaSong.find(c => c.id === a?.id);
      if (a && selected && !a.referenceEditedAt && (a.workId !== selected.workId || a.album !== selected.album || a.artist !== selected.artist))
        issues.push(`${a.id}：未经显式人工修改，自动候选不能覆盖人工选择`);
    });
  return issues;
}

/** Upgrade old browser catalogs while retaining deliberately edited candidates and conflicts. */
export function upgradeReferenceCatalog(catalog: Catalog): Catalog {
  if (catalog.referenceVersion === REFERENCE_VERSION) return catalog;
  const conflicts = [...(catalog.referenceConflicts || [])];
  const current = currentReferenceAnchors();
  const anchors = current.map(next => {
    const previous = catalog.anchors.find(a => a.id === next.id);
    const old = baseline.get(next.id);
    if (!previous || !old) return next;
    const addition = additions[previous.id as keyof typeof additions];
    const unchangedAddition = addition && previous.album === addition.album && previous.feature === addition.feature;
    const edited = previous.approved || previous.referenceEditedAt || previous.reviewedBy || (different(previous, old) && !unchangedAddition);
    if (!edited) return next;
    if (next.manualLocked) {
      conflicts.push({ id: next.id, reason: "最新截图人工选择优先；升级前的本机编辑完整保留供复核。", previous: structuredClone(previous) });
      return next;
    }
    return { ...previous, status: previous.approved ? previous.status : "local-review", pending: `${previous.pending || ""} 本机编辑已保留，请在管理工具中检查新去重规则。` };
  });
  return { ...catalog, referenceVersion: REFERENCE_VERSION, anchors, ...(conflicts.length ? { referenceConflicts: conflicts } : {}) };
}
