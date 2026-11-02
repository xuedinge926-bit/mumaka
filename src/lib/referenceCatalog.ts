import additions from "../data/reference-additions.json";
import type { Anchor, Catalog } from "../model/v040/types";

/** Fill only the three explicitly unassigned, unapproved R3 positions. Never replace a reviewed candidate. */
export function referenceAnchors(catalog: Catalog): Anchor[] {
  return catalog.anchors.map((a) => {
    const candidate = additions[a.id as keyof typeof additions];
    return !a.approved && a.unassigned && candidate
      ? {
          ...a,
          ...candidate,
          unassigned: false,
          approved: false,
          status: "draft",
          listening: "未做完整试听",
          version: "v0.41-reference-draft",
          pending: "补全整碟试听及相邻等级比较后由用户审定。",
        }
      : a;
  });
}
