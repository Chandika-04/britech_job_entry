export const THEME_STORAGE_KEY = "britech.theme";
export const THEME_VARS_STORAGE_KEY = "britech.theme.vars";

export const INK = "#16202c";
export const WHITE = "#ffffff";
export const DEFAULT_THEME_HEX = "#1f54c9";

export const THEME_PRESETS = [
  { id: "blue", name: "Blue (default)", hex: "#1f54c9" },
  { id: "teal", name: "Teal", hex: "#0f766e" },
  { id: "green", name: "Green", hex: "#2f7d32" },
  { id: "purple", name: "Purple", hex: "#6d3fc0" },
  { id: "red", name: "Red", hex: "#b42318" },
  { id: "orange", name: "Orange", hex: "#e8711a" },
  { id: "yellow", name: "Yellow", hex: "#f2c230" },
  { id: "slate", name: "Slate", hex: "#475569" },
] as const;

export type ThemeVars = {
  "--color-accent": string;
  "--color-accent-hover": string;
  "--color-accent-soft": string;
  "--color-card-header": string;
  "--color-accent-ink": string;
  "--color-card-header-ink": string;
  "--color-accent-text": string;
  "--color-accent-grid": string;
};

type Rgb = { r: number; g: number; b: number };

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function parseHex(hex: string): Rgb | null {
  const raw = hex.trim().replace(/^#/, "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((ch) => clampByte(ch).toString(16).padStart(2, "0")).join("")}`;
}

function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  const t = Math.max(0, Math.min(1, amount));
  return {
    r: a.r * (1 - t) + b.r * t,
    g: a.g * (1 - t) + b.g * t,
    b: a.b * (1 - t) + b.b * t,
  };
}

function channelLuminance(value: number): number {
  const s = value / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const lighter = Math.max(luminance(a), luminance(b));
  const darker = Math.min(luminance(a), luminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function pickInk(background: Rgb): string {
  const white = parseHex(WHITE)!;
  const ink = parseHex(INK)!;
  return contrastRatio(background, white) >= contrastRatio(background, ink) ? WHITE : INK;
}

function darkenForTextOnWhite(color: Rgb): Rgb {
  const white = parseHex(WHITE)!;
  const black = { r: 0, g: 0, b: 0 };
  let current = color;
  for (let i = 0; i < 40; i += 1) {
    if (contrastRatio(current, white) >= 4.5) return current;
    current = mix(current, black, 0.08);
  }
  return current;
}

export function themeVarsFromHex(hex: string): ThemeVars | null {
  const accent = parseHex(hex);
  if (!accent) return null;
  const white = parseHex(WHITE)!;
  const black = { r: 0, g: 0, b: 0 };
  const hover = mix(accent, black, 0.12);
  const soft = mix(white, accent, 0.12);
  const header = mix(white, accent, 0.24);
  const text = darkenForTextOnWhite(accent);
  return {
    "--color-accent": toHex(accent),
    "--color-accent-hover": toHex(hover),
    "--color-accent-soft": toHex(soft),
    "--color-card-header": toHex(header),
    "--color-accent-ink": pickInk(accent),
    "--color-card-header-ink": pickInk(header),
    "--color-accent-text": toHex(text),
    "--color-accent-grid": `rgb(${clampByte(accent.r)} ${clampByte(accent.g)} ${clampByte(accent.b)} / 0.05)`,
  };
}

function writeVars(vars: ThemeVars) {
  const root = document.documentElement.style;
  (Object.entries(vars) as Array<[keyof ThemeVars, string]>).forEach(([name, value]) => {
    root.setProperty(name, value);
  });
}

function persist(hex: string, vars: ThemeVars) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, hex);
    localStorage.setItem(THEME_VARS_STORAGE_KEY, JSON.stringify(vars));
  } catch {
    // localStorage may be blocked
  }
}

export function readStoredThemeHex(): string {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)?.trim() ?? "";
    if (parseHex(stored)) return stored.startsWith("#") ? stored : `#${stored}`;
  } catch {
    // localStorage may be blocked
  }
  return DEFAULT_THEME_HEX;
}

export function applyTheme(hex: string): ThemeVars {
  const vars = themeVarsFromHex(hex) ?? themeVarsFromHex(DEFAULT_THEME_HEX)!;
  const resolved = vars["--color-accent"];
  writeVars(vars);
  persist(resolved, vars);
  return vars;
}

export function applyStoredTheme(): ThemeVars {
  return applyTheme(readStoredThemeHex());
}

export function initTheme() {
  applyStoredTheme();
  window.addEventListener("storage", (event) => {
    if (event.key === THEME_STORAGE_KEY || event.key === THEME_VARS_STORAGE_KEY) applyStoredTheme();
  });
}
