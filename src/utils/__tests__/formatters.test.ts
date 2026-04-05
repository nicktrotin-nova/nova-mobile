import {
  timeToMinutes,
  minutesToTime,
  formatTime12,
  formatTime12Compact,
  addMinutesToTime,
  normalizeService,
  normalizeStatus,
  clientDisplayName,
  clientInitials,
} from "../formatters";

// ─── timeToMinutes ──────────────────────────────────────────────────────────

describe("timeToMinutes", () => {
  it("converts HH:MM:SS format", () => {
    expect(timeToMinutes("09:00:00")).toBe(540);
    expect(timeToMinutes("13:30:00")).toBe(810);
    expect(timeToMinutes("00:00:00")).toBe(0);
    expect(timeToMinutes("23:59:00")).toBe(1439);
  });

  it("converts HH:MM format", () => {
    expect(timeToMinutes("09:00")).toBe(540);
    expect(timeToMinutes("13:30")).toBe(810);
  });

  it("handles midnight", () => {
    expect(timeToMinutes("00:00")).toBe(0);
  });

  it("handles noon", () => {
    expect(timeToMinutes("12:00")).toBe(720);
  });
});

// ─── minutesToTime ──────────────────────────────────────────────────────────

describe("minutesToTime", () => {
  it("converts minutes to HH:MM:00 format", () => {
    expect(minutesToTime(540)).toBe("09:00:00");
    expect(minutesToTime(810)).toBe("13:30:00");
    expect(minutesToTime(0)).toBe("00:00:00");
  });

  it("wraps past 24 hours", () => {
    expect(minutesToTime(1440)).toBe("00:00:00"); // 24*60
    expect(minutesToTime(1500)).toBe("01:00:00"); // 25*60
  });

  it("pads single digits", () => {
    expect(minutesToTime(65)).toBe("01:05:00");
  });
});

// ─── formatTime12 ───────────────────────────────────────────────────────────

describe("formatTime12", () => {
  it("formats HH:MM:SS to 12-hour", () => {
    expect(formatTime12("09:00:00")).toBe("9:00 AM");
    expect(formatTime12("13:30:00")).toBe("1:30 PM");
    expect(formatTime12("00:00:00")).toBe("12:00 AM");
    expect(formatTime12("12:00:00")).toBe("12:00 PM");
  });

  it("formats HH:MM to 12-hour", () => {
    expect(formatTime12("09:00")).toBe("9:00 AM");
    expect(formatTime12("17:45")).toBe("5:45 PM");
  });

  it("returns empty string for null", () => {
    expect(formatTime12(null)).toBe("");
  });

  it("returns original string on bad input", () => {
    expect(formatTime12("not-a-time")).toBe("not-a-time");
  });
});

// ─── formatTime12Compact ────────────────────────────────────────────────────

describe("formatTime12Compact", () => {
  it("drops minutes when on the hour", () => {
    expect(formatTime12Compact("09:00")).toBe("9am");
    expect(formatTime12Compact("13:00")).toBe("1pm");
    expect(formatTime12Compact("12:00")).toBe("12pm");
  });

  it("shows minutes when not on the hour", () => {
    expect(formatTime12Compact("09:30")).toBe("9:30am");
    expect(formatTime12Compact("13:15")).toBe("1:15pm");
  });

  it("handles midnight", () => {
    expect(formatTime12Compact("00:00")).toBe("12am");
  });
});

// ─── addMinutesToTime ───────────────────────────────────────────────────────

describe("addMinutesToTime", () => {
  it("adds minutes within the same hour", () => {
    expect(addMinutesToTime("09:00", 30)).toBe("09:30");
  });

  it("adds minutes crossing hour boundary", () => {
    expect(addMinutesToTime("09:45", 30)).toBe("10:15");
  });

  it("wraps past midnight", () => {
    expect(addMinutesToTime("23:30", 60)).toBe("00:30");
  });
});

// ─── normalizeService ───────────────────────────────────────────────────────

describe("normalizeService", () => {
  it("returns single object unchanged", () => {
    const svc = { id: "1", name: "Haircut" };
    expect(normalizeService(svc)).toBe(svc);
  });

  it("returns first element of array", () => {
    const svc = { id: "1", name: "Haircut" };
    expect(normalizeService([svc])).toBe(svc);
  });

  it("returns null for empty array", () => {
    expect(normalizeService([])).toBeNull();
  });

  it("returns null for null/undefined", () => {
    expect(normalizeService(null)).toBeNull();
    expect(normalizeService(undefined)).toBeNull();
  });
});

// ─── normalizeStatus ────────────────────────────────────────────────────────

describe("normalizeStatus", () => {
  it('converts legacy "noshow" to "no_show"', () => {
    expect(normalizeStatus("noshow")).toBe("no_show");
  });

  it("passes through other statuses", () => {
    expect(normalizeStatus("confirmed")).toBe("confirmed");
    expect(normalizeStatus("completed")).toBe("completed");
    expect(normalizeStatus("no_show")).toBe("no_show");
  });
});

// ─── clientDisplayName ──────────────────────────────────────────────────────

describe("clientDisplayName", () => {
  it("joins first and last name", () => {
    expect(clientDisplayName("Glen", "Smith")).toBe("Glen Smith");
  });

  it("returns first name only when no last name", () => {
    expect(clientDisplayName("Glen", null)).toBe("Glen");
    expect(clientDisplayName("Glen", "")).toBe("Glen");
  });

  it('falls back to "Client" when both empty', () => {
    expect(clientDisplayName(null, null)).toBe("Client");
    expect(clientDisplayName("", "")).toBe("Client");
    expect(clientDisplayName(undefined, undefined)).toBe("Client");
  });

  it("trims whitespace", () => {
    expect(clientDisplayName("  Glen  ", "  Smith  ")).toBe("Glen Smith");
  });
});

// ─── clientInitials ─────────────────────────────────────────────────────────

describe("clientInitials", () => {
  it("returns two-letter initials uppercase", () => {
    expect(clientInitials("Glen", "Smith")).toBe("GS");
  });

  it("returns one letter when only first name", () => {
    expect(clientInitials("Glen", null)).toBe("G");
  });

  it('returns "?" when both empty', () => {
    expect(clientInitials(null, null)).toBe("?");
    expect(clientInitials("", "")).toBe("?");
  });
});
