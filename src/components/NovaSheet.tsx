/**
 * NovaSheet — shared bottom sheet component.
 *
 * Default case (covers BlockDetailSheet, BlockCreationSheet, AppointmentDetailSheet):
 *
 *   <NovaSheet visible={v} onClose={close} title="Blocked Time">
 *     {content}
 *   </NovaSheet>
 *
 * That gives you: obsidian700 surface, scrim overlay, drag handle, title + X header,
 * scrollable body, slide animation, maxHeight 0.85. Zero config.
 *
 * Less common cases:
 *
 *   // Fixed footer (AppointmentDetailSheet pattern)
 *   <NovaSheet visible={v} onClose={close} title="Appointment Details"
 *     headerLeft={<View style={[styles.dot, { backgroundColor: dotColor }]} />}
 *     footer={<View style={footerStyles}>{buttons}</View>}
 *   >
 *     {content}
 *   </NovaSheet>
 *
 *   // Custom Animated entrance + fixed height (WalkInSheet / CreateBookingSheet)
 *   <NovaSheet visible={v} onClose={close} title="Walk-in"
 *     animation="custom"
 *     height={0.7}
 *     scrollable={false}
 *   >
 *     {content}
 *   </NovaSheet>
 */

import React, { useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Pressable,
  Dimensions,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { X } from "lucide-react-native";
import { colors, LABEL, MUTED } from "../theme/colors";

// ─── Interface ───────────────────────────────────────────────────────────────

export interface NovaSheetProps {
  /** Controls visibility */
  visible: boolean;
  /** Called when scrim tapped, X tapped, or Android back pressed */
  onClose: () => void;
  /** Header title — renders to the left of the X button */
  title?: string;
  /** Content inside the scrollable (or non-scrollable) body */
  children: React.ReactNode;

  // ── Less common ──

  /** Element rendered to the left of the title (e.g. status dot) */
  headerLeft?: React.ReactNode;
  /** Replaces the default title+X header entirely. Use when you need
   *  full control (e.g. back button, step indicator). You handle your own X. */
  renderHeader?: () => React.ReactNode;
  /** Fixed footer pinned below the scroll area (e.g. action buttons).
   *  Rendered outside the ScrollView, above safe-area bottom padding. */
  footer?: React.ReactNode;
  /** Sheet height as fraction of screen height.
   *  - `undefined` (default) → maxHeight 0.85 (sheet sizes to content)
   *  - `number` → fixed height (e.g. 0.7 = 70% of screen) */
  height?: number;
  /** Whether the body wraps children in a ScrollView. Default: true */
  scrollable?: boolean;
  /** Animation mode.
   *  - `"slide"` (default) — uses Modal's built-in slide animation
   *  - `"custom"` — Modal has animationType="none", sheet does its own
   *    Animated.View translateY entrance (like WalkInSheet/CreateBookingSheet) */
  animation?: "slide" | "custom";
  /** Pass-through to ScrollView's keyboardShouldPersistTaps. Default: "handled" */
  keyboardPersistTaps?: "always" | "never" | "handled";
  /** Additional padding at bottom of scroll content. Default: 16 */
  scrollPaddingBottom?: number;
  /** testID for the sheet container */
  testID?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SCREEN_HEIGHT = Dimensions.get("window").height;
const DEFAULT_MAX_HEIGHT_RATIO = 0.85;
const ENTRANCE_DURATION = 220;
const ENTRANCE_OFFSET = 34;

// ─── Component ───────────────────────────────────────────────────────────────

export default function NovaSheet({
  visible,
  onClose,
  title,
  children,
  headerLeft,
  renderHeader,
  footer,
  height,
  scrollable = true,
  animation = "slide",
  keyboardPersistTaps = "handled",
  scrollPaddingBottom = 16,
  testID,
}: NovaSheetProps) {
  const isCustom = animation === "custom";

  // Animated values for custom entrance
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const sheetTranslateY = useRef(new Animated.Value(ENTRANCE_OFFSET)).current;

  useEffect(() => {
    if (!isCustom) return;
    if (visible) {
      overlayOpacity.setValue(0);
      sheetTranslateY.setValue(ENTRANCE_OFFSET);
      Animated.parallel([
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: 170,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(sheetTranslateY, {
          toValue: 0,
          duration: ENTRANCE_DURATION,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      overlayOpacity.setValue(0);
      sheetTranslateY.setValue(ENTRANCE_OFFSET);
    }
  }, [visible, isCustom, overlayOpacity, sheetTranslateY]);

  // ── Size computation ──

  const isFixedHeight = height != null;
  const computedHeight = isFixedHeight
    ? Math.round(SCREEN_HEIGHT * height)
    : undefined;
  const computedMaxHeight = isFixedHeight
    ? undefined
    : SCREEN_HEIGHT * DEFAULT_MAX_HEIGHT_RATIO;

  // ── Render pieces ──

  const handleView = <View style={styles.handle} />;

  const defaultHeader = (
    <View style={styles.headerRow}>
      <View style={styles.headerLeft}>
        {headerLeft}
        {title ? <Text style={styles.headerTitle}>{title}</Text> : null}
      </View>
      <TouchableOpacity onPress={onClose} hitSlop={12} delayPressIn={0}>
        <View pointerEvents="none">
          <X size={20} color={MUTED} />
        </View>
      </TouchableOpacity>
    </View>
  );

  const headerContent = renderHeader ? renderHeader() : defaultHeader;

  const bodyContent = scrollable ? (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={{ paddingBottom: scrollPaddingBottom }}
      keyboardShouldPersistTaps={keyboardPersistTaps}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={styles.bodyNoScroll}>{children}</View>
  );

  // ── Sheet surface (shared between both animation modes) ──

  const sheetSizeStyle = isFixedHeight
    ? { height: computedHeight, minHeight: computedHeight }
    : { maxHeight: computedMaxHeight };

  const sheetInner = (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.keyboardAvoid}
    >
      {handleView}
      {headerContent}
      {bodyContent}
      {footer}
    </KeyboardAvoidingView>
  );

  // ── Render ──

  if (isCustom) {
    return (
      <Modal
        visible={visible}
        transparent
        animationType="none"
        onRequestClose={onClose}
      >
        <View style={styles.overlayCustom}>
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              styles.scrimLayer,
              { opacity: overlayOpacity },
            ]}
          />
          <Pressable style={styles.scrimTap} onPress={onClose} />
          <Animated.View
            testID={testID}
            style={[
              styles.sheet,
              sheetSizeStyle,
              { transform: [{ translateY: sheetTranslateY }] },
            ]}
          >
            {sheetInner}
          </Animated.View>
        </View>
      </Modal>
    );
  }

  // Default: slide animation via Modal
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.scrimTap} onPress={onClose} />
        <View testID={testID} style={[styles.sheet, sheetSizeStyle]}>
          {sheetInner}
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Slide animation: scrim is part of overlay bg
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: colors.scrim,
  },
  // Custom animation: scrim is a separate animated layer
  overlayCustom: {
    flex: 1,
    justifyContent: "flex-end",
  },
  scrimLayer: {
    backgroundColor: colors.black50,
  },
  scrimTap: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.obsidian700,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textGhost,
    marginTop: 12,
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    marginRight: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "Satoshi-Bold",
    color: LABEL,
  },
  scroll: {},
  bodyNoScroll: {
    flex: 1,
  },
  keyboardAvoid: {
    flex: 1,
  },
});
