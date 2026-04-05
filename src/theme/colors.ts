// Nova colour system — Nova Green on Obsidian
// 28 tokens. Every pixel pulls from this palette or it doesn't ship.

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
  textSecondary: "rgba(245,243,239,0.65)", // 65%
  textTertiary: "rgba(245,243,239,0.40)",  // 40%
  textGhost: "rgba(245,243,239,0.22)",     // 22% — placeholders, disabled
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
  trackOff: "#2E323B", // = obsidian600
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
