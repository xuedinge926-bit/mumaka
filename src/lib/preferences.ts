import type { AlbumUX } from "../model/types";

export interface Preferences {
  market: AlbumUX["market"];
  cardRatio: NonNullable<AlbumUX["cardRatio"]>;
}
const defaults: Preferences = { market: "china", cardRatio: "4:5" };
export function readPreferences(): Preferences {
  try {
    const value = JSON.parse(
      localStorage.getItem("mumaka-preferences-v1") || "{}",
    );
    return {
      market: value?.market === "global" ? "global" : "china",
      cardRatio: ["4:5", "3:4", "1:1"].includes(value?.cardRatio)
        ? value.cardRatio
        : "4:5",
    };
  } catch {
    return { ...defaults };
  }
}
export function writePreferences(value: Preferences): void {
  localStorage.setItem("mumaka-preferences-v1", JSON.stringify(value));
}
