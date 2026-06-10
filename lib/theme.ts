export type ThemeId = "synthwave" | "matrix" | "inferno" | "ice";

export interface ThemeDef {
  id: ThemeId;
  name: string;
  description: string;
  /** swatch colors for the picker [bg, accent, cyan, purple] */
  swatch: [string, string, string, string];
}

export const THEMES: ThemeDef[] = [
  { id: "synthwave", name: "Synthwave", description: "Magenta & cyan · Blade Runner", swatch: ["#0a0612", "#ff2bd6", "#00e5ff", "#b14bff"] },
  { id: "matrix", name: "Matrix", description: "Verde neon · terminal hacker", swatch: ["#020604", "#00ff8c", "#00e5ff", "#7cff6b"] },
  { id: "inferno", name: "Inferno", description: "Vermelho & âmbar · molten", swatch: ["#0c0604", "#ff4d2e", "#ffb800", "#ff2d6f"] },
  { id: "ice", name: "Ice", description: "Azul gelo · frio e limpo", swatch: ["#05080f", "#38bdf8", "#22d3ee", "#818cf8"] },
];

const KEY = "lionbot-theme";

export function getTheme(): ThemeId {
  if (typeof window === "undefined") return "synthwave";
  const t = localStorage.getItem(KEY) as ThemeId | null;
  return t && THEMES.some((x) => x.id === t) ? t : "synthwave";
}

export function applyTheme(id: ThemeId) {
  if (typeof document === "undefined") return;
  if (id === "synthwave") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", id);
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
}
