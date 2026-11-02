import { useId, useState, useRef, useEffect } from "react";
import { Info } from "lucide-react";
import { StarRating } from "./StarRating";
import { HELP } from "../model/v040/definitions";
import { ENGLISH, NAMES, type Category } from "../model/v040/types";
import { levelStandard } from "../lib/referencePresentation";

export function DimensionRating({
  category,
  index,
  tick,
  weight,
  disabled,
  shared,
  onChange,
}: {
  category: Category;
  index: number;
  tick: number | null;
  weight: number | null;
  disabled: boolean;
  shared: boolean;
  onChange: (value: number | null) => void;
}) {
  const [preview, setPreview] = useState<number | null>(null),
    [info, setInfo] = useState(false),
    [hover, setHover] = useState(false),
    id = useId(),
    helpRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!info) return;
    const close = (e: PointerEvent) => {
      if (!helpRef.current?.contains(e.target as Node)) setInfo(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [info]);
  const name = NAMES[category][index],
    help = HELP[category][index],
    value = tick === null ? null : tick / 2;
  const shown = preview ?? value;
  const description = (stars: number) => levelStandard(category, name, stars);
  return (
    <div className="dual-dimension" data-dimension={name}>
      <div className="dual-dimension-heading">
        <div
          ref={helpRef}
          className="dimension-help"
          onPointerEnter={(e) => {
            if (e.pointerType === "mouse") setHover(true);
          }}
          onPointerLeave={() => setHover(false)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setInfo(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setInfo(false);
              setHover(false);
            }
          }}
        >
          <h3>
            <button
              type="button"
              aria-label={`${name}说明`}
              aria-expanded={info || hover}
              aria-controls={`${id}-help`}
              onClick={() => setInfo(!info)}
            >
              {name}
              <small>{ENGLISH[category][index]}</small>
              <Info size={14} />
            </button>
          </h3>
          <div
            id={`${id}-help`}
            className={`dimension-tooltip ${info || hover ? "is-visible" : ""}`}
            role="note"
          >
            <button
              type="button"
              className="tooltip-close"
              aria-label={`关闭${name}说明`}
              onClick={() => {
                setInfo(false);
                setHover(false);
              }}
            >
              关闭 ×
            </button>
            <p>{help.scope}</p>
            <p>
              <b>边界：</b>
              {help.boundary}
            </p>
          </div>
          {shared && <small className="dual-muted">整张专辑</small>}
        </div>
        <b>{weight === null ? "—" : `${weight / 2}%`}</b>
      </div>
      <div className="dual-star-row">
        <StarRating
          label={name}
          value={value}
          disabled={disabled}
          describedBy={`${id}-level`}
          describeValue={description}
          onPreview={setPreview}
          onChange={onChange}
        />
        <span>{shown === null ? "未评价" : `${shown.toFixed(1)} ★`}</span>
        <button
          className="quiet-link"
          disabled={disabled || value === null}
          aria-label={`清除${name}评分`}
          onClick={() => onChange(null)}
        >
          清除
        </button>
      </div>
      <p
        id={`${id}-level`}
        className={`star-level ${preview !== null ? "is-preview" : ""}`}
        data-preview={preview !== null}
      >
        {shown === null
          ? "悬停预览等级，点击半颗或整颗星评分。"
          : `${preview !== null ? "预览" : "已选"} ${shown.toFixed(1)} 星 · ${description(shown)}`}
      </p>
      <span className="sr-only" aria-live="polite">
        {value === null
          ? `${name}未评分`
          : `${name}已选${value}星。${description(value)}`}
      </span>
    </div>
  );
}
