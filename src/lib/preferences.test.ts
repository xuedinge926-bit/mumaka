import { beforeEach, expect, it, vi } from "vitest";
import { readPreferences, writePreferences } from "./preferences";
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  });
});
it("migrates old preferences while preserving export ratio and region", () => {
  localStorage.setItem(
    "mumaka-preferences-v1",
    JSON.stringify({ market: "global", cardRatio: "1:1" }),
  );
  expect(readPreferences()).toMatchObject({
    market: "global",
    cardRatio: "1:1",
    appearance: "system",
    reduceMotion: false,
  });
});
it("persists appearance, card defaults and reading choices; validates corrupt values", () => {
  const p = {
    ...readPreferences(),
    appearance: "dark" as const,
    accent: "blue" as const,
    referenceExpanded: true,
    reduceMotion: true,
    cardTheme: "ink" as const,
  };
  writePreferences(p);
  expect(readPreferences()).toEqual(p);
  localStorage.setItem("mumaka-preferences-v1", "{bad");
  expect(readPreferences().appearance).toBe("system");
  localStorage.setItem(
    "mumaka-preferences-v1",
    JSON.stringify({ appearance: "unknown", cardRatio: "99:1" }),
  );
  expect(readPreferences().cardRatio).toBe("4:5");
});
