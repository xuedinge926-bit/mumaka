import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, X } from "lucide-react";
import type { Preferences } from "../lib/preferences";

interface Props {
  preferences: Preferences;
  onChange: (value: Preferences) => void;
}
export function AppearanceControls({ preferences: p, onChange }: Props) {
  return (
    <>
      <fieldset className="appearance-options">
        <legend>外观</legend>
        <div className="dual-segment" role="group" aria-label="外观模式">
          {(
            [
              ["light", "亮色"],
              ["dark", "暗色"],
              ["system", "跟随系统"],
            ] as const
          ).map(([value, name]) => (
            <button
              key={value}
              aria-pressed={p.appearance === value}
              onClick={() => onChange({ ...p, appearance: value })}
            >
              {name}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="appearance-options">
        <legend>主题色</legend>
        <div className="accent-options" role="group" aria-label="主题色">
          {(
            [
              ["terracotta", "陶土"],
              ["forest", "松绿"],
              ["blue", "靛蓝"],
            ] as const
          ).map(([value, name]) => (
            <button
              key={value}
              className={`accent-swatch ${value}`}
              aria-pressed={p.accent === value}
              onClick={() => onChange({ ...p, accent: value })}
            >
              <i aria-hidden="true" />
              {name}
            </button>
          ))}
        </div>
      </fieldset>
    </>
  );
}
export function AppearanceMenu(props: Props & { onSettings: () => void }) {
  const [open, setOpen] = useState(false),
    panel = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const pointer = (e: PointerEvent) => {
      if (
        !panel.current?.contains(e.target as Node) &&
        !trigger.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div className="appearance-menu">
      <button
        ref={trigger}
        className="icon-button"
        aria-label="外观与设置"
        aria-expanded={open}
        aria-controls="appearance-popover"
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={21} />
      </button>
      {open && (
        <div
          ref={panel}
          id="appearance-popover"
          className="appearance-popover"
          role="dialog"
          aria-label="外观快捷设置"
        >
          <div className="appearance-heading">
            <b>让界面适合你</b>
            <button
              className="icon-button"
              aria-label="关闭外观设置"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <X size={17} />
            </button>
          </div>
          <AppearanceControls {...props} />
          <button
            className="quiet-link"
            onClick={() => {
              setOpen(false);
              props.onSettings();
            }}
          >
            全部设置 →
          </button>
        </div>
      )}
    </div>
  );
}
export function SettingsPage(props: Props) {
  const p = props.preferences,
    update = (value: Partial<Preferences>) =>
      props.onChange({ ...p, ...value });
  return (
    <main className="settings-page workspace-page">
      <h1>设置</h1>
      <p className="page-intro">把常用的样子留下来。</p>
      <section className="dual-panel">
        <h2>外观与阅读</h2>
        <AppearanceControls {...props} />
        <label className="dual-checkbox">
          <input
            type="checkbox"
            checked={p.referenceExpanded}
            onChange={(e) => update({ referenceExpanded: e.target.checked })}
          />
          默认展开参考专辑说明
        </label>
        <label className="dual-checkbox">
          <input
            type="checkbox"
            checked={p.reduceMotion}
            onChange={(e) => update({ reduceMotion: e.target.checked })}
          />
          减少动画
        </label>
      </section>
      <section className="dual-panel preference-fields">
        <h2>新评分的默认偏好</h2>
        <p>创建新作品时应用，已有作品保留各自设置。</p>
        <label>
          卡片比例
          <select
            aria-label="默认导出比例"
            value={p.cardRatio}
            onChange={(e) =>
              update({ cardRatio: e.target.value as Preferences["cardRatio"] })
            }
          >
            {["4:5", "3:4", "1:1"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          卡片配色
          <select
            aria-label="默认卡片配色"
            value={p.cardTheme}
            onChange={(e) =>
              update({ cardTheme: e.target.value as Preferences["cardTheme"] })
            }
          >
            <option value="paper">纸色</option>
            <option value="ink">墨色</option>
          </select>
        </label>
        <label>
          默认地区
          <select
            aria-label="默认地区"
            value={p.market}
            onChange={(e) =>
              update({ market: e.target.value as Preferences["market"] })
            }
          >
            <option value="china">中国</option>
            <option value="global">外国</option>
          </select>
        </label>
      </section>
      <p className="page-intro">
        设置保存在此浏览器。评分数据的备份与恢复位于「数据与工具」。
      </p>
    </main>
  );
}
