import React, { memo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { CreditCard, Banknote, Wallet } from "lucide-react-native";
import { colors, NOVA_GREEN, LABEL, MUTED, DIM } from "../theme/colors";
import { formatTime12 } from "../utils/formatters";
import type { Appointment, EmbeddedService } from "../types/domain";

// ─── Types ──────────────────────────────────────────────────────────────────

type Variant = "list" | "transaction";

interface AppointmentCardProps {
  appointment: Pick<
    Appointment,
    | "client_name"
    | "start_time"
    | "end_time"
    | "status"
    | "price_charged"
    | "payment_method"
    | "services"
  >;
  /** "list" = time|client+service|price (MyDay, BarberDetail).
   *  "transaction" = pay-icon|client+service+meta|price (Wallet). */
  variant?: Variant;
  /** Extra text shown below service in transaction variant (e.g. "Mon"). */
  meta?: string;
  /** Show end time below start time (BarberDetail style). */
  showEndTime?: boolean;
  /** Dim completed cards. Default true. */
  dimCompleted?: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const PAYMENT_ICONS = {
  card: CreditCard,
  cash: Banknote,
  prepaid: Wallet,
} as const;

function serviceName(s: EmbeddedService | null | undefined): string {
  return s?.name ?? "Service";
}

function formatPrice(price: number | null | undefined): string {
  if (price == null) return "—";
  return `$${Number(price).toFixed(0)}`;
}

// ─── Component ──────────────────────────────────────────────────────────────

function AppointmentCard({
  appointment: apt,
  variant = "list",
  meta,
  showEndTime = false,
  dimCompleted = true,
}: AppointmentCardProps) {
  const isCompleted = apt.status === "completed";
  const isNoShow = apt.status === "no_show";
  const faded = dimCompleted && (isCompleted || isNoShow);

  if (variant === "transaction") {
    const PayIcon =
      PAYMENT_ICONS[(apt.payment_method as keyof typeof PAYMENT_ICONS) ?? "card"] ?? CreditCard;
    return (
      <View style={[s.txRow, faded && s.faded]}>
        <View style={s.txIconWrap}>
          <View pointerEvents="none">
            <PayIcon size={14} color={DIM} strokeWidth={2} />
          </View>
        </View>
        <View style={s.txLeft}>
          <Text style={s.clientName} numberOfLines={1}>
            {apt.client_name?.trim() || "Walk-in"}
          </Text>
          <Text style={s.serviceMuted} numberOfLines={1}>
            {serviceName(apt.services)}
            {meta ? ` · ${meta}` : ""}
          </Text>
        </View>
        <Text style={s.priceGreen}>{formatPrice(apt.price_charged)}</Text>
      </View>
    );
  }

  // variant === "list"
  return (
    <View style={[s.listRow, faded && s.faded]}>
      <View style={s.timeCol}>
        <Text style={s.timeText}>{formatTime12(apt.start_time)}</Text>
        {showEndTime && (
          <Text style={s.timeEnd}>{formatTime12(apt.end_time)}</Text>
        )}
      </View>
      <View style={s.mainCol}>
        <Text
          style={[s.clientName, isNoShow && s.noShowStrike]}
          numberOfLines={1}
        >
          {apt.client_name?.trim() || "Walk-in"}
        </Text>
        <Text style={s.serviceMuted} numberOfLines={1}>
          {serviceName(apt.services)}
        </Text>
      </View>
      <View style={s.rightCol}>
        <Text style={[s.priceGreen, isCompleted && s.priceCompleted]}>
          {formatPrice(apt.price_charged)}
        </Text>
        {isCompleted && <Text style={s.statusDone}>Done</Text>}
        {isNoShow && <Text style={s.statusNoShow}>No-show</Text>}
      </View>
    </View>
  );
}

export default memo(AppointmentCard);

// ─── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  // ── Shared ──
  faded: { opacity: 0.55 },

  clientName: {
    fontSize: 14,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: LABEL,
  },

  serviceMuted: {
    fontSize: 12,
    fontFamily: "Satoshi-Regular",
    color: MUTED,
    marginTop: 2,
  },

  priceGreen: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: NOVA_GREEN,
    minWidth: 48,
    textAlign: "right",
  },

  // ── List variant ──
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.obsidian800,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 6,
  },

  timeCol: {
    width: 56,
    marginRight: 10,
  },

  timeText: {
    fontSize: 12,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: LABEL,
    fontVariant: ["tabular-nums"],
  },

  timeEnd: {
    fontSize: 10,
    fontFamily: "Satoshi-Regular",
    color: DIM,
    fontVariant: ["tabular-nums"],
    marginTop: 1,
  },

  mainCol: {
    flex: 1,
    marginRight: 8,
  },

  rightCol: {
    alignItems: "flex-end",
    marginLeft: 8,
  },

  noShowStrike: {
    textDecorationLine: "line-through",
    color: MUTED,
  },

  priceCompleted: {
    color: MUTED,
  },

  statusDone: {
    fontSize: 10,
    fontFamily: "Satoshi-Medium",
    fontWeight: "500",
    color: colors.success,
    marginTop: 2,
  },

  statusNoShow: {
    fontSize: 10,
    fontFamily: "Satoshi-Medium",
    fontWeight: "500",
    color: colors.error,
    marginTop: 2,
  },

  // ── Transaction variant ──
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.obsidian800,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderLight,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 8,
  },

  txIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.obsidian600,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },

  txLeft: {
    flex: 1,
    marginRight: 10,
  },
});
