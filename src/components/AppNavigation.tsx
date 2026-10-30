import { useEffect, useRef, useState, type RefObject } from "react";
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
}
export function AppNavigation({
  open,
  onClose,
  route,
  onNavigate,
  toggleRef,
}: Props) {
  const panel = useRef<HTMLElement>(null);
  const [mobile, setMobile] = useState(
    () => window.matchMedia("(max-width: 760px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const changed = () => setMobile(media.matches);
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    if (!open) return;
    const focusWas = document.activeElement;
    if (mobile)
      panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const previousOverflow = document.body.style.overflow;
    if (mobile) document.body.style.overflow = "hidden";
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        toggleRef.current?.focus();
      }
      if (event.key === "Tab" && mobile) {
        const choices = Array.from(
          panel.current?.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
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
      if (mobile && focusWas === toggleRef.current) toggleRef.current?.focus();
    };
  }, [open, mobile, onClose, toggleRef]);
  return (
    <>
      {mobile && open && (
        <button
          className="app-nav-scrim"
          aria-label="关闭导航遮罩"
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
        role={mobile ? "dialog" : undefined}
        aria-modal={mobile && open ? true : undefined}
      >
        <div className="app-navigation-heading">
          <div>
            <b>MUMAKA</b>
            <span>新乐评主义</span>
          </div>
          <button
            className="icon-button"
            aria-label="收起侧边导航"
            onClick={() => {
              onClose();
              toggleRef.current?.focus();
            }}
          >
            <X size={19} />
          </button>
        </div>
        <nav aria-label="应用导航">
          {(Object.keys(WORKSPACE_LABELS) as Workspace[]).map((tab) => (
            <button
              key={tab}
              aria-current={
                route.view === "workspace" && route.tab === tab
                  ? "page"
                  : undefined
              }
              onClick={() => {
                onNavigate(tab);
                if (mobile) onClose();
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
