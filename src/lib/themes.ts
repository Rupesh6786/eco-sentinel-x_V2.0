export type ThemeMode = "dark" | "light";

export const DASHBOARD_THEMES = [
  { id: 1, name: "Solar" },
  { id: 2, name: "Tide" },
  { id: 3, name: "Canopy" },
  { id: 4, name: "Ember" },
  { id: 5, name: "Orchid" },
  { id: 6, name: "Glacier" },
  { id: 7, name: "Rose" },
  { id: 8, name: "Citrus" },
  { id: 9, name: "Lagoon" },
  { id: 10, name: "Graphite" },
] as const;

export function randomThemeId(random: () => number = Math.random): number {
  return Math.floor(random() * DASHBOARD_THEMES.length) + 1;
}