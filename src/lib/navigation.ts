import { useCallback, useEffect, useState } from "react";

export const WORKSPACE_LABELS = {
  home: "首页",
  library: "作品库",
  ratings: "评分记录",
  genres: "风格管理",
  research: "V0.35 研究评分",
  cards: "评分卡",
  data: "数据管理",
  settings: "设置",
} as const;
export type Workspace = keyof typeof WORKSPACE_LABELS;
export type EditorStage = "confirm" | "rating" | "card";
export type AppRoute =
  | { view: "workspace"; tab: Workspace; research?: { kind: 'draft' | 'revision'; id: string } }
  | {
      view: "editor";
      kind: "album" | "snapshot";
      id: string;
      stage: EditorStage;
    };
export const HOME: AppRoute = { view: "workspace", tab: "home" };
const stages = new Set(["confirm", "rating", "card"]);
const marker = "mumakaNavigation";

export function routePath(route: AppRoute): string {
  return route.view === "workspace"
    ? route.tab === 'research' && route.research
      ? `/research/${route.research.kind}/${encodeURIComponent(route.research.id)}`
      : `/${route.tab}`
    : `/${route.kind}/${encodeURIComponent(route.id)}/${route.stage}`;
}
export function parseRoute(hash: string): AppRoute {
  const path = hash.replace(/^#/, "");
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 3 && segments[0] === 'research' && ['draft', 'revision'].includes(segments[1])) {
    try {
      const id = decodeURIComponent(segments[2]);
      if (id && id.length <= 500 && !/[\u0000-\u001f]/u.test(id)) return { view: 'workspace', tab: 'research', research: { kind: segments[1] as 'draft' | 'revision', id } };
    } catch { /* Invalid research IDs use the normal fallback. */ }
    return HOME;
  }
  if (segments.length === 1 && Object.hasOwn(WORKSPACE_LABELS, segments[0]))
    return { view: "workspace", tab: segments[0] as Workspace };
  if (
    segments.length === 3 &&
    ["album", "snapshot"].includes(segments[0]) &&
    stages.has(segments[2])
  ) {
    try {
      const id = decodeURIComponent(segments[1]);
      if (id && id.length <= 500 && !/[\u0000-\u001f]/u.test(id))
        return {
          view: "editor",
          kind: segments[0] as "album" | "snapshot",
          id,
          stage: segments[2] as EditorStage,
        };
    } catch {
      /* Invalid links go to a usable home route. */
    }
  }
  return HOME;
}
export function routeLabel(route: AppRoute): string {
  return route.view === "workspace"
    ? WORKSPACE_LABELS[route.tab]
    : { confirm: "专辑资料", rating: "六维评分", card: "评分卡预览" }[
        route.stage
      ];
}
function position(): number {
  const value = window.history.state?.[marker]?.index;
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
function href(route: AppRoute): string {
  return (
    window.location.pathname + window.location.search + "#" + routePath(route)
  );
}
function state(index: number): Record<string, unknown> {
  const previous = window.history.state;
  return {
    ...(previous && typeof previous === "object" ? previous : {}),
    [marker]: { version: 1, index },
  };
}
function initial() {
  const route = parseRoute(window.location.hash),
    index = position();
  // Hash routes work on the existing Pages subdirectory and in a single HTML.
  // Do not replace the path, origin, search parameters, or any browser data.
  window.history.replaceState(state(index), "", href(route));
  return { route, index };
}

/** Real browser history, not a set of disconnected React page states. */
export function useAppRoute() {
  const [current, setCurrent] = useState(initial);
  useEffect(() => {
    const read = () =>
      setCurrent({
        route: parseRoute(window.location.hash),
        index: position(),
      });
    window.addEventListener("popstate", read);
    window.addEventListener("hashchange", read);
    return () => {
      window.removeEventListener("popstate", read);
      window.removeEventListener("hashchange", read);
    };
  }, []);
  const navigate = useCallback((route: AppRoute, replace = false) => {
    const path = routePath(route);
    if (window.location.hash === "#" + path) return;
    const index = position() + (replace ? 0 : 1);
    window.history[replace ? "replaceState" : "pushState"](
      state(index),
      "",
      href(route),
    );
    setCurrent({ route, index });
  }, []);
  const back = useCallback(() => {
    if (position() > 0) window.history.back();
    else navigate(HOME);
  }, [navigate]);
  return {
    route: current.route,
    key: routePath(current.route),
    navigate,
    back,
    canBack: current.index > 0,
  };
}
