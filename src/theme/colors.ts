// Nova colour system — Nova Green on Obsidian
// Every pixel pulls from this palette or it doesn't ship.

// ── Helper: derive rgba from any hex + opacity ──
export function withOpacity(hex: string, opacity: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

export const colors = {
  // ── Surfaces: Obsidian (warm charcoal, not navy) ──
  obsidian950: "#0C0D0F", // deepest black, status bar
  obsidian900: "#131518", // app canvas
  obsidian800: "#1B1D22", // cards
  obsidian700: "#24272E", // sheets, modals, elevated
  obsidian600: "#2E323B", // input wells, recessed areas
  obsidian500: "#3A3F4A", // borders (use sparingly — prefer shadow)

  // ── Nova: Money + Brand (Nova Green) ──
  nova600: "#00A86E", // pressed state
  nova500: "#00D68F", // primary — prices, take-home, brand, wordmark
  nova400: "#33E0A5", // secondary money, completed badges
  nova300: "#7AECBF", // progress fills, subtle indicators

  // Hero gradient endpoints (for take-home number only)
  novaGradientStart: "#00D68F",
  novaGradientEnd: "#7AECBF",

  // ── Steel: Legacy mid-tone (kept as subtle accent, no longer active/selected) ──
  steel600: "#5E6B82", // legacy mid-tone
  steel500: "#7B8AA3", // legacy mid-tone
  steel400: "#94A3BB", // legacy mid-tone
  steel300: "#B0BDD0", // legacy mid-tone

  // ── Paper: Calendar light surfaces ──
  paper50: "#FAF8F5",  // calendar body
  paper100: "#F0EDE7", // grid lines, time labels bg
  paper200: "#E5E0D8", // dividers on light surfaces
  paper300: "#C8C1B5", // muted text on light surfaces

  // ── Text: Warm white, opacity-based hierarchy ──
  textPrimary: "#F5F3EF",                 // 100%
  textSecondary: "rgba(245,243,239,0.65)" as const, // 65% = warmWhite65
  textTertiary: "rgba(245,243,239,0.40)" as const,  // 40% = warmWhite40
  textGhost: "rgba(245,243,239,0.22)" as const,     // 22% = warmWhite22
  textInverse: "#131518",                  // on light/gold surfaces

  // ── Status ──
  success: "#4ADE80", // confirmed, complete (system state, NOT money)
  error: "#F87171",   // failed, cancelled
  warning: "#FBBF24", // attention, behind on rent

  // ── Special ──
  now: "#00D68F",            // current time line — green, "now is where money is made"
  scrim: "rgba(0,0,0,0.6)", // modal overlay

  // ── Calendar-specific ──
  calendarBody: "#F7F5F2",          // neutral-warm cotton paper — available hours
  calendarHourLine: "rgba(0,0,0,0.08)",
  calendarHalfLine: "rgba(0,0,0,0.03)",
  calendarBlockBg: "#2E323B",       // = obsidian600 — lighter than appt cards
  calendarUnavailable: "#0C0D0F",   // = obsidian950 — deep void "closed" zones
  calendarCardBg: "#1B1D22",        // = obsidian800 — dark cards on warm paper

  // ── Borders (opacity-based) ──
  border: "rgba(245,243,239,0.06)",
  borderMedium: "rgba(245,243,239,0.10)",
  borderLight: "rgba(245,243,239,0.04)",

  // ── Utilities ──
  white: "#FFFFFF",
  black: "#000000",
  trackOff: "#2E323B", // = obsidian600

  // ── Warm white at opacity (F5F3EF) ──
  warmWhite04: "rgba(245,243,239,0.04)",
  warmWhite06: "rgba(245,243,239,0.06)",
  warmWhite08: "rgba(245,243,239,0.08)",
  warmWhite09: "rgba(245,243,239,0.09)",
  warmWhite10: "rgba(245,243,239,0.10)",
  warmWhite15: "rgba(245,243,239,0.15)",
  warmWhite16: "rgba(245,243,239,0.16)",
  warmWhite20: "rgba(245,243,239,0.20)",
  warmWhite22: "rgba(245,243,239,0.22)",
  warmWhite25: "rgba(245,243,239,0.25)",
  warmWhite30: "rgba(245,243,239,0.30)",
  warmWhite35: "rgba(245,243,239,0.35)",
  warmWhite40: "rgba(245,243,239,0.40)",
  warmWhite45: "rgba(245,243,239,0.045)",
  warmWhite50: "rgba(245,243,239,0.50)",
  warmWhite55: "rgba(245,243,239,0.55)",
  warmWhite65: "rgba(245,243,239,0.65)",

  // ── Pure white at opacity ──
  white03: "rgba(255,255,255,0.03)",
  white04: "rgba(255,255,255,0.04)",
  white06: "rgba(255,255,255,0.06)",
  white08: "rgba(255,255,255,0.08)",
  white10: "rgba(255,255,255,0.10)",
  white12: "rgba(255,255,255,0.12)",
  white15: "rgba(255,255,255,0.15)",
  white25: "rgba(255,255,255,0.25)",
  white30: "rgba(255,255,255,0.30)",

  // ── Black at opacity ──
  black03: "rgba(0,0,0,0.03)",
  black04: "rgba(0,0,0,0.04)",
  black06: "rgba(0,0,0,0.06)",
  black08: "rgba(0,0,0,0.08)",
  black18: "rgba(0,0,0,0.18)",
  black20: "rgba(0,0,0,0.20)",
  black30: "rgba(0,0,0,0.30)",
  black50: "rgba(0,0,0,0.50)",
  black60: "rgba(0,0,0,0.60)",

  // ── Nova green at opacity ──
  nova06: "rgba(0,214,143,0.06)",
  nova08: "rgba(0,214,143,0.08)",
  nova10: "rgba(0,214,143,0.10)",
  nova12: "rgba(0,214,143,0.12)",
  nova15: "rgba(0,214,143,0.15)",
  nova20: "rgba(0,214,143,0.20)",
  nova25: "rgba(0,214,143,0.25)",
  nova30: "rgba(0,214,143,0.30)",
  nova35: "rgba(0,214,143,0.35)",
  nova40: "rgba(0,214,143,0.40)",
  nova90: "rgba(0,214,143,0.9)",

  // ── Error red at opacity (F87171) ──
  error04: "rgba(248,113,113,0.04)",
  error06: "rgba(248,113,113,0.06)",
  error10: "rgba(248,113,113,0.10)",
  error15: "rgba(248,113,113,0.15)",
  error20: "rgba(248,113,113,0.2)",

  // ── Error red alt at opacity (EF4444) ──
  errorAlt10: "rgba(239,68,68,0.10)",
  errorAlt20: "rgba(239,68,68,0.2)",

  // ── Warning at opacity (FBBF24) ──
  warning10: "rgba(251,191,36,0.1)",
  warning20: "rgba(251,191,36,0.2)",

  // ── Steel/slate at opacity (94A3B8) ──
  steel10: "rgba(148,163,184,0.10)",
  steel12: "rgba(148,163,184,0.12)",
  steel35: "rgba(148,163,184,0.35)",
  steel50: "rgba(148,163,184,0.50)",

  // ── Steel alt at opacity (94A3BB) ──
  steelAlt04: "rgba(148,163,187,0.04)",
  steelAlt06: "rgba(148,163,187,0.06)",
  steelAlt10: "rgba(148,163,187,0.1)",
  steelAlt15: "rgba(148,163,187,0.15)",
  steelAlt20: "rgba(148,163,187,0.2)",

  // ── Canvas at opacity (131518) ──
  canvas85: "rgba(19,21,24,0.85)",
  canvas90: "rgba(19,21,24,0.9)",
  canvas92: "rgba(19,21,24,0.92)",

  // ── Accent purple at opacity (A78BFA) ──
  purple04: "rgba(167,139,250,0.04)",
  purple80: "rgba(167,139,250,0.8)",
} as const;

// ── Convenience aliases ──
export const NOVA_GREEN = colors.nova500;
export const STEEL = colors.textPrimary;
export const BG = colors.obsidian900;
export const LABEL = colors.textPrimary;
export const MUTED = colors.textSecondary;
export const DIM = colors.textTertiary;
export const CARD_BG = colors.obsidian800;
export const BORDER = colors.border;
