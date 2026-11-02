import { ScoreCard } from "./ScoreCard";
import { cardData } from "../lib/v040Exports";
import { calculate } from "../model/v040/engine";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  NAMES,
  type Draft,
  type Catalog,
  type Snapshot,
} from "../model/v040/types";

export function DualScoreCard({
  draft,
  catalog,
  snapshot,
}: {
  draft: Draft;
  catalog: Catalog;
  snapshot?: Snapshot | null;
}) {
  const data = cardData(draft, catalog, snapshot);
  if (!draft.mixed.enabled)
    return (
      <ScoreCard data={data} ratio={draft.cardRatio} theme={draft.cardTheme} />
    );
  const height =
    draft.cardRatio === "1:1" ? 1080 : draft.cardRatio === "3:4" ? 1440 : 1350;
  const dark = draft.cardTheme === "ink",
    ink = dark ? "#f5f0e5" : "#353a35";
  const c = snapshot?.calculation ?? calculate(draft, catalog);
  const top = height - 285;
  return (
    <svg
      id="score-card-svg"
      viewBox={`0 0 1080 ${height}`}
      width="1080"
      height={height}
      role="img"
      aria-label={`${draft.title || "未命名专辑"}的混合评分卡`}
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      <rect width="1080" height={height} fill={dark ? "#242624" : "#f7f3eb"} />
      <metadata>{JSON.stringify(data.research?.metadata)}</metadata>
      <svg
        x="0"
        y="0"
        width="1080"
        height={height - 300}
        viewBox={`0 0 1080 ${height}`}
      >
        <ScoreCard
          svgId="dual-card-main"
          data={data}
          ratio={draft.cardRatio}
          theme={draft.cardTheme}
        />
      </svg>
      <g
        fill={ink}
        fontFamily="'PingFang SC', 'Microsoft YaHei', sans-serif"
        fontSize="21"
      >
        <text x="64" y={top + 28} fontWeight="700">
          混合专辑分项 · 按作品艺术比重人工审核
        </text>
        {CATEGORIES.map((category, j) => (
          <g key={category}>
            <text x="64" y={top + 75 + j * 68}>
              {CATEGORY_LABELS[category]}{" "}
              {category === "song"
                ? draft.mixed.songShareTicks / 2
                : 100 - draft.mixed.songShareTicks / 2}
              %
            </text>
            <text x="64" y={top + 106 + j * 68} fontSize="19">
              {NAMES[category]
                .slice(0, 4)
                .map(
                  (name, i) =>
                    `${name} ${draft.modes[category].ratingsTicks[i] === null ? "—" : draft.modes[category].ratingsTicks[i]! / 2}★ × ${(c.weights[category]?.[i] ?? 0) / 2}%`,
                )
                .join("    ")}
            </text>
          </g>
        ))}
        <text x="64" y={top + 232}>
          专辑一次：愿景 {(draft.mixed.visionTicks ?? 0) / 2}★ × 15%　语境{" "}
          {(draft.mixed.contextTicks ?? 0) / 2}★ × 15%
        </text>
        <text
          x="64"
          y={top + 275}
          fontSize="17"
        >{`人工审核：${draft.mixed.reviewer || "待审"} · 比重不是按曲目数量自动平均`}</text>
      </g>
    </svg>
  );
}
