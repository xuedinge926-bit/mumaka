import type { Anchor, Catalog } from "../model/v040/types";
import { upgradeReferenceCatalog } from "./referenceReview";

/** Homepage, complete reference and manager read the same versioned working selection. */
export function referenceAnchors(catalog: Catalog): Anchor[] {
  return upgradeReferenceCatalog(catalog).anchors;
}
