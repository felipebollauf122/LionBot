export type ThemeId = "synthwave" | "dark" | "matrix" | "inferno" | "ice" | "gold" | "mono" | "custom";

export interface ThemeDef {
  id: ThemeId;
  name: string;
  description: string;
  /** swatch colors for the picker [bg, accent, cyan, purple] */
  swatch: [string, string, string, string];
}

export const THEMES: ThemeDef[] = [
  { id: "synthwave", name: "Synthwave", description: "Magenta & cyan · Blade Runner", swatch: ["#08040e", "#ff2bd6", "#00e5ff", "#b14bff"] },
  { id: "dark", name: "Vampiro", description: "Preto breu · vermelho-sangue", swatch: ["#000000", "#e23b3b", "#d14b4b", "#8a8a8a"] },
  { id: "matrix", name: "Matrix", description: "Verde neon · terminal hacker", swatch: ["#010402", "#00ff8c", "#00e5ff", "#7cff6b"] },
  { id: "inferno", name: "Inferno", description: "Vermelho & âmbar · molten", swatch: ["#090402", "#ff4d2e", "#ffb800", "#ff2d6f"] },
  { id: "ice", name: "Ice", description: "Azul gelo · frio e limpo", swatch: ["#03050b", "#38bdf8", "#22d3ee", "#818cf8"] },
  { id: "gold", name: "Gold", description: "Dourado · luxo", swatch: ["#070503", "#f5c85c", "#e0a44a", "#c9933a"] },
  { id: "mono", name: "Mono", description: "Branco & cinza · minimalista", swatch: ["#030303", "#f5f5f5", "#a3a3a3", "#d4d4d4"] },
];

export interface CustomColors {
  bg: string;
  accent: string;
  cyan: string;
  purple: string;
}

export const DEFAULT_CUSTOM: CustomColors = { bg: "#06030c", accent: "#ff2bd6", cyan: "#00e5ff", purple: "#b14bff" };

const KEY = "lionbot-theme";
const CUSTOM_KEY = "lionbot-custom";

export function getTheme(): ThemeId {
  if (typeof window === "undefined") return "synthwave";
  const t = localStorage.getItem(KEY) as ThemeId | null;
  const valid = [...THEMES.map((x) => x.id), "custom"];
  return t && valid.includes(t) ? t : "synthwave";
}

export function getCustomColors(): CustomColors {
  if (typeof window === "undefined") return DEFAULT_CUSTOM;
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (raw) return { ...DEFAULT_CUSTOM, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return DEFAULT_CUSTOM;
}

/** hex → "r, g, b" for rgba/color-mix interpolation. */
function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** Write the custom palette as inline CSS vars on <html> (derives muted/glow). */
export function applyCustomColors(c: CustomColors) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  const set = (k: string, v: string) => el.style.setProperty(k, v);
  const a = hexToRgb(c.accent), cy = hexToRgb(c.cyan), pu = hexToRgb(c.purple), bg = hexToRgb(c.bg);

  set("--accent", c.accent);
  set("--accent-hover", `color-mix(in srgb, ${c.accent} 70%, white)`);
  set("--accent-muted", `rgba(${a}, 0.12)`);
  set("--accent-glow", `rgba(${a}, 0.45)`);
  set("--accent-deep", `rgba(${a}, 0.06)`);
  set("--cyan", c.cyan);
  set("--cyan-muted", `rgba(${cy}, 0.12)`);
  set("--cyan-glow", `rgba(${cy}, 0.40)`);
  set("--purple", c.purple);
  set("--purple-muted", `rgba(${pu}, 0.12)`);
  set("--purple-glow", `rgba(${pu}, 0.40)`);
  // Camadas mais sutis = fundo mais preto (clareia menos rumo ao branco).
  set("--bg-root", c.bg);
  set("--bg-surface", `color-mix(in srgb, ${c.bg} 95%, white)`);
  set("--bg-elevated", `color-mix(in srgb, ${c.bg} 90%, white)`);
  set("--bg-overlay", `color-mix(in srgb, ${c.bg} 85%, white)`);
  set("--glass-bg", `rgba(${bg}, 0.85)`);
  set("--border-subtle", `rgba(${a}, 0.10)`);
  set("--border-default", `rgba(${a}, 0.18)`);
  set("--border-glow", `rgba(${a}, 0.22)`);
  set("--status-active", c.accent);
}

/** Clear inline custom vars (when switching away from custom). */
function clearCustomVars() {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  [
    "--accent", "--accent-hover", "--accent-muted", "--accent-glow", "--accent-deep",
    "--cyan", "--cyan-muted", "--cyan-glow", "--purple", "--purple-muted", "--purple-glow",
    "--bg-root", "--bg-surface", "--bg-elevated", "--bg-overlay", "--glass-bg",
    "--border-subtle", "--border-default", "--border-glow", "--status-active",
  ].forEach((k) => el.style.removeProperty(k));
}

export function applyTheme(id: ThemeId) {
  if (typeof document === "undefined") return;
  if (id === "custom") {
    document.documentElement.setAttribute("data-theme", "custom");
    applyCustomColors(getCustomColors());
  } else {
    clearCustomVars();
    if (id === "synthwave") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", id);
  }
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
}

export function saveCustomColors(c: CustomColors) {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
  applyCustomColors(c);
}
