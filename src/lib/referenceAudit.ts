import { NAMES, type Anchor, type Category } from "../model/v040/types";

export interface ReferenceIssue {
  severity: "error" | "warning";
  code: string;
  id: string;
  message: string;
}
export function normalizeArtist(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}
export function artistIdentity(a: Anchor) {
  return a.primaryArtistId?.trim() || normalizeArtist(a.artist);
}
export function workIdentity(a: Anchor) {
  return a.workId?.trim() || `${normalizeArtist(a.artist)}:${normalizeArtist(a.album)}:${a.year}`;
}
export function validReferenceUrl(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}
/** Structural constraints are independent of listening approval. */
export function auditReferences(anchors: Anchor[]): ReferenceIssue[] {
  const issues: ReferenceIssue[] = [];
  const add = (code: string, id: string, message: string, severity: ReferenceIssue["severity"] = "error") =>
    issues.push({ code, id, message, severity });
  if (anchors.length !== 168 || new Set(anchors.map(a => a.id)).size !== 168)
    add("coverage", "all", "四表必须合计168个唯一格位。");
  for (const region of ["china", "global"])
    for (const category of ["song", "instrumental"] as Category[]) {
      const groupId = `${region}-${category}`;
      const table = anchors.filter(a => a.region === region && a.category === category);
      if (table.length !== 42) add("coverage", groupId, "每表必须恰有42格。");
      for (const dimension of NAMES[category]) {
        const cells = table.filter(a => a.dimension === dimension);
        const stars = cells.map(a => a.stars).sort((a,b) => a-b).join(",");
        if (stars !== "2,2.5,3,3.5,4,4.5,5") add("coverage", groupId, `${dimension}须完整覆盖2.0—5.0七档。`);
        if (new Set(cells.map(artistIdentity)).size !== 7 || new Set(cells.map(a => normalizeArtist(a.artist))).size !== 7)
          for (const a of cells) add("dimension-artist", a.id, "同维七档必须使用七位不同主艺人。");
      }
      // Check stable IDs and display names: inventing another ID does not bypass the rule.
      for (const key of [artistIdentity, (a: Anchor) => normalizeArtist(a.artist)]) {
        const counts = new Map<string, Anchor[]>();
        for (const a of table) counts.set(key(a), [...(counts.get(key(a)) || []), a]);
        const repeated = [...counts.values()].filter(c => c.length > 1);
        for (const cells of repeated)
          if (cells.length > 2 || repeated.length > 1)
            for (const a of cells) add("table-artist", a.id, "每表最多只允许一位主艺人出现两次，其余各一次。");
      }
      for (const key of [workIdentity, (a: Anchor) => `${normalizeArtist(a.artist)}:${normalizeArtist(a.album)}`]) {
        const seen = new Set<string>();
        for (const a of table) {
          if (seen.has(key(a))) add("duplicate-work", a.id, "同一张专辑不能在表中重复占格。");
          seen.add(key(a));
        }
      }
    }
  for (const a of anchors) {
    const fields = [a.album, a.artist, a.year, a.mainGenre, a.feature, a.workId, a.primaryArtistId, a.edition, a.status, a.evidence, a.confidence];
    if (a.unassigned || fields.some(v => typeof v !== "string" || !v.trim())) add("metadata", a.id, "缺少作品身份、年份、主风格、整碟理由或审查资料。");
    if (!/^\d{4}$/.test(a.year) || Number(a.year) < 1900 || Number(a.year) > 2026) add("year", a.id, "发行年份必须为1900—2026的四位年份。");
    if (!a.sources.length || a.sources.some(u => !validReferenceUrl(u))) add("sources", a.id, "需要至少一个可信资料的HTTPS地址。");
    if (a.coverUrl && (!validReferenceUrl(a.coverUrl) || !a.coverSource || !validReferenceUrl(a.coverSource) || !a.coverLicense)) add("cover", a.id, "封面必须附可核出处和版权用途说明。");
    if (/安河桥北/.test(a.album)) add("title", a.id, "专辑正确名称为安和桥北。");
    if (/亲密关系.*Close to Me/i.test(a.album)) add("title", a.id, "发行正式名称为亲幂关系 Close to Me；截图原文另存。");
    if (!a.approved) add("unreviewed", a.id, a.status === "discussion" ? "人工位置保留，等级或版本待商议。" : "研究候选，未完成整碟人工审定。", "warning");
  }
  return issues.filter((v, i, list) => list.findIndex(x => x.code === v.code && x.id === v.id && x.message === v.message) === i);
}
