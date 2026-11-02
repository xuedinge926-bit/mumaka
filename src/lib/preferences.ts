import { useEffect } from "react";
import type { AlbumUX } from "../model/types";

export interface Preferences {
  market: AlbumUX["market"];
  cardRatio: NonNullable<AlbumUX["cardRatio"]>;
  cardTheme: "paper" | "ink";
  appearance: "light" | "dark" | "system";
  accent: "terracotta" | "forest" | "blue";
  referenceExpanded: boolean;
  reduceMotion: boolean;
}
export const DEFAULT_PREFERENCES: Preferences = {
  market: "china",
  cardRatio: "4:5",
  cardTheme: "paper",
  appearance: "system",
  accent: "terracotta",
  referenceExpanded: false,
  reduceMotion: false,
};
export const PREFERENCES_KEY = "mumaka-preferences-v1";
export function readPreferences(): Preferences {
  try {
    const v = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || "{}");
    return {
      market: v?.market === "global" ? "global" : "china",
      cardRatio: ["4:5", "3:4", "1:1"].includes(v?.cardRatio)
        ? v.cardRatio
        : "4:5",
      cardTheme: v?.cardTheme === "ink" ? "ink" : "paper",
      appearance: ["light", "dark", "system"].includes(v?.appearance)
        ? v.appearance
        : "system",
      accent: ["terracotta", "forest", "blue"].includes(v?.accent)
        ? v.accent
        : "terracotta",
      referenceExpanded: v?.referenceExpanded === true,
      reduceMotion: v?.reduceMotion === true,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}
export function writePreferences(value: Preferences) {
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(value));
}
export function useAppearance(preferences: Preferences) {
  useEffect(() => {
    const color = window.matchMedia("(prefers-color-scheme: dark)");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      document.documentElement.dataset.theme =
        preferences.appearance === "system"
          ? color.matches
            ? "dark"
            : "light"
          : preferences.appearance;
      document.documentElement.dataset.accent = preferences.accent;
      document.documentElement.dataset.reduceMotion = String(
        preferences.reduceMotion || motion.matches,
      );
      document.documentElement.style.colorScheme =
        document.documentElement.dataset.theme;
    };
    apply();
    color.addEventListener("change", apply);
    motion.addEventListener("change", apply);
    return () => {
      color.removeEventListener("change", apply);
      motion.removeEventListener("change", apply);
    };
  }, [preferences.appearance, preferences.accent, preferences.reduceMotion]);
}
