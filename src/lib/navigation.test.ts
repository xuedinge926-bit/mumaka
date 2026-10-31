import { describe, expect, it } from "vitest";
import {
  HOME,
  parseRoute,
  routeLabel,
  routePath,
  WORKSPACE_LABELS,
} from "./navigation";

describe("Pages-compatible navigation addresses", () => {
  it("has a usable home for absent and malformed hashes", () => {
    for (const hash of [
      "",
      "#/",
      "#/missing",
      "#/album/%ZZ/rating",
      "#/album/a/delete",
      "#/snapshot//card",
    ])
      expect(parseRoute(hash)).toEqual(HOME);
  });
  it("covers every real workspace destination", () => {
    for (const tab of Object.keys(
      WORKSPACE_LABELS,
    ) as (keyof typeof WORKSPACE_LABELS)[]) {
      const route = { view: "workspace" as const, tab };
      expect(parseRoute("#" + routePath(route))).toEqual(route);
      expect(routeLabel(route)).toBe(WORKSPACE_LABELS[tab]);
    }
  });
  it('round-trips separate research drafts and immutable revision routes', () => {
    for (const kind of ['draft','revision'] as const) {
      const route = {view:'workspace' as const,tab:'research' as const,research:{kind,id:'研究 / version#1'}};
      expect(parseRoute('#'+routePath(route))).toEqual(route);
    }
    for (const hash of ['#/research/delete/x','#/research/revision/%ZZ','#/research/draft/%00']) expect(parseRoute(hash)).toEqual(HOME);
  });
  it("keeps legacy arbitrary record IDs and frozen history separate, including encoded slashes", () => {
    for (const kind of ["album", "snapshot"] as const)
      for (const stage of ["confirm", "rating", "card"] as const) {
        const route = {
          view: "editor" as const,
          kind,
          id: "旧记录 / version?1#",
          stage,
        };
        expect(parseRoute("#" + routePath(route))).toEqual(route);
      }
  });
});
