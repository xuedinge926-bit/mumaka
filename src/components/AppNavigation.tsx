import { useEffect, useRef, type RefObject } from "react";
import { ArrowLeft, ChevronRight, X } from "lucide-react";
import {
  WORKSPACE_LABELS,
  type AppRoute,
  type Workspace,
  routeLabel,
} from "../lib/navigation";

interface Props {
  open: boolean;
  onClose: () => void;
  route: AppRoute;
  onNavigate: (tab: Workspace) => void;
  toggleRef: RefObject<HTMLButtonElement | null>;
  legacyMode?: boolean;
}
export function AppNavigation({
  open,
  onClose,
  route,
  onNavigate,
  toggleRef,
  legacyMode = false,
}: Props) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key === "Tab") {
        const choices = Array.from(
          panel.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), a[href]",
          ) ?? [],
        );
        const first = choices[0],
          last = choices.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = previousOverflow;
      toggleRef.current?.focus();
    };
  }, [open, onClose, toggleRef]);
  const tabs: Workspace[] = legacyMode
    ? ["home", "library", "ratings", "genres", "cards", "data", "settings"]
    : ["home", "library", "ratings", "genres", "reference", "settings", "data"];
  return (
    <>
      {open && (
        <button
          className="app-nav-scrim"
          aria-label="关闭导航遮罩"
          tabIndex={-1}
          onClick={onClose}
        />
      )}
      <aside
        id="app-navigation"
        ref={panel}
        className={`app-navigation ${open ? "is-open" : ""}`}
        aria-label="功能菜单"
        aria-hidden={!open}
        inert={!open}
        role="dialog"
        aria-modal={open || undefined}
      >
        <div className="app-navigation-heading">
          <span>导航</span>
          <button
            className="icon-button"
            aria-label="收起侧边导航"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
        <nav aria-label="应用导航">
          {tabs.map((tab) => (
            <button
              key={tab}
              aria-current={
                route.view === "workspace" && route.tab === tab
                  ? "page"
                  : undefined
              }
              onClick={() => {
                onNavigate(tab);
                onClose();
              }}
            >
              {WORKSPACE_LABELS[tab]}
              <ChevronRight size={13} />
            </button>
          ))}
        </nav>
      </aside>
    </>
  );
}

export function WorkspaceBreadcrumb({
  route,
  onHome,
  onBack,
  canBack,
}: {
  route: AppRoute;
  onHome: () => void;
  onBack: () => void;
  canBack: boolean;
}) {
  if (route.view === "workspace" && route.tab === "home") return null;
  return (
    <div className="workspace-breadcrumb">
      <button className="back-link" aria-label="返回上一级" onClick={onBack}>
        <ArrowLeft size={15} />
        {canBack ? "返回" : "返回首页"}
      </button>
      <nav aria-label="当前位置">
        <button onClick={onHome}>首页</button>
        <ChevronRight size={13} />
        {route.view === "editor" && (
          <>
            <span>{route.kind === "snapshot" ? "评分历史" : "专辑编辑"}</span>
            <ChevronRight size={13} />
          </>
        )}
        <span aria-current="page">{routeLabel(route)}</span>
      </nav>
    </div>
  );
}
