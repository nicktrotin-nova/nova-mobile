import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Switch,
  Alert,
  Modal,
  Pressable,
  Keyboard,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Scissors,
  ArrowLeft,
  Delete,
} from "lucide-react-native";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import type { MoreStackParamList } from "../navigation/MoreStack";
import { colors, BG, NOVA_GREEN, STEEL, MUTED, DIM, LABEL, CARD_BG, BORDER } from "../theme/colors";
import { useScreenData } from "../hooks/useScreenData";

const TRACK_OFF = colors.trackOff;

const DURATION_OPTIONS = [15, 30, 45, 60, 90] as const;

// ── Category metadata ─────────────────────────────────────────────────────────

const CATEGORY_META: Record<string, { label: string }> = {
  hair: { label: "Haircuts" },
  beard: { label: "Beard & Face" },
  combo: { label: "Combos" },
  colour: { label: "Colour" },
  treatment: { label: "Treatments" },
  other: { label: "Other" },
};

// ── Types ──────────────────────────────────────────────────────────────────────

interface ShopService {
  id: string;
  name: string;
  category: string | null;
  display_order: number | null;
}

interface BarberService {
  id: string;
  service_id: string;
  price: number;
  duration_minutes: number | null;
  is_offered: boolean;
  is_in_next_available_pool: boolean | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function catKey(s: ShopService): string {
  const c = (s.category || "other").toLowerCase().trim();
  return CATEGORY_META[c] ? c : "other";
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MyServicesScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<MoreStackParamList>>();
  const { barberId, shopId } = useAuth();

  const [shopServices, setShopServices] = useState<ShopService[]>([]);
  const [myServices, setMyServices] = useState<BarberService[]>([]);

  // Navigation
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  // Price keypad
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [keypadTarget, setKeypadTarget] = useState<{
    bsId: string;
    name: string;
    currentPrice: number;
  } | null>(null);

  // Duration picker
  const [durationPickerOpen, setDurationPickerOpen] = useState(false);
  const [durationPickerTarget, setDurationPickerTarget] = useState<{
    bsId: string;
    name: string;
    currentDuration: number;
  } | null>(null);

  // Create service
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newDuration, setNewDuration] = useState(30);
  const [newCategory, setNewCategory] = useState("hair");
  const [creating, setCreating] = useState(false);

  // ── Data loading ──────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!barberId || !shopId) return;
    const [shopRes, myRes] = await Promise.all([
      supabase
        .from("services")
        .select("id, name, category, display_order")
        .eq("shop_id", shopId)
        .eq("is_active", true)
        .order("display_order"),
      supabase
        .from("barber_services")
        .select(
          "id, service_id, price, duration_minutes, is_offered, is_in_next_available_pool",
        )
        .eq("barber_id", barberId),
    ]);
    setShopServices((shopRes.data ?? []) as ShopService[]);
    setMyServices((myRes.data ?? []) as BarberService[]);
  }, [barberId, shopId]);

  const { loading } = useScreenData(load, [load], !!(barberId && shopId));

  // ── Derived data ──────────────────────────────────────────────────────────

  const getBs = (serviceId: string) =>
    myServices.find((bs) => bs.service_id === serviceId);

  const categoryGroups = useMemo(() => {
    const groups: Record<string, ShopService[]> = {};
    for (const s of shopServices) {
      const key = catKey(s);
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    }
    return groups;
  }, [shopServices]);

  const activeCategories = Object.keys(categoryGroups);

  const offeredCount = myServices.filter((bs) => bs.is_offered).length;
  const totalMenuValue = myServices
    .filter((bs) => bs.is_offered)
    .reduce((sum, bs) => sum + Number(bs.price ?? 0), 0);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const toggleOffered = async (bs: BarberService) => {
    const { error } = await supabase
      .from("barber_services")
      .update({ is_offered: !bs.is_offered })
      .eq("id", bs.id);
    if (error) { Alert.alert("Could not update", error.message); return; }
    await load();
  };

  const addToMenu = async (serviceId: string) => {
    if (!barberId) return;
    const { error } = await supabase.from("barber_services").insert({
      barber_id: barberId,
      service_id: serviceId,
      price: 0,
      duration_minutes: 30,
      is_offered: true,
      is_in_next_available_pool: true,
    });
    if (error) { Alert.alert("Could not add service", error.message); return; }
    await load();
  };

  const updatePrice = async (bsId: string, newPriceVal: number) => {
    const { error } = await supabase
      .from("barber_services")
      .update({ price: newPriceVal })
      .eq("id", bsId);
    if (error) { Alert.alert("Could not update price", error.message); return; }
    await load();
  };

  const updateDuration = async (bsId: string, dur: number) => {
    const { error } = await supabase
      .from("barber_services")
      .update({ duration_minutes: dur })
      .eq("id", bsId);
    if (error) { Alert.alert("Could not update duration", error.message); return; }
    await load();
  };

  const createService = async () => {
    if (!barberId || !shopId) return;
    const price = parseFloat(newPrice);
    if (!newName.trim()) {
      Alert.alert("Service name is required");
      return;
    }
    if (isNaN(price) || price < 0) {
      Alert.alert("Enter a valid price");
      return;
    }
    setCreating(true);
    try {
      const { data: svc, error: sErr } = await supabase
        .from("services")
        .insert({
          shop_id: shopId,
          name: newName.trim(),
          category: activeCategory || newCategory,
          is_active: true,
          display_order: 999,
        })
        .select()
        .single();
      if (sErr) throw sErr;
      await supabase.from("barber_services").insert({
        barber_id: barberId,
        service_id: svc.id,
        price,
        duration_minutes: newDuration,
        is_offered: true,
        is_in_next_available_pool: true,
      });
      await load();
      setCreateOpen(false);
      setNewName("");
      setNewPrice("");
      setNewDuration(30);
    } catch (e: unknown) {
      Alert.alert(
        "Could not create service",
        e instanceof Error ? e.message : "Something went wrong",
      );
    } finally {
      setCreating(false);
    }
  };

  // ── Render: Loading ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScreenHeader onBack={() => navigation.goBack()} title="My Services" />
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={NOVA_GREEN} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  // ── Render: Category detail ───────────────────────────────────────────────

  if (activeCategory) {
    const meta = CATEGORY_META[activeCategory] || CATEGORY_META.other;
    const services = categoryGroups[activeCategory] || [];

    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScreenHeader onBack={() => navigation.goBack()} title="My Services" />
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Back to categories */}
          <TouchableOpacity
            style={styles.backRow}
            onPress={() => setActiveCategory(null)}
            activeOpacity={0.7}
          >
            <View pointerEvents="none" style={{ marginRight: 6 }}>
              <ArrowLeft size={16} color={MUTED} strokeWidth={2} />
            </View>
            <Text style={styles.backText}>Back to categories</Text>
          </TouchableOpacity>

          <Text style={styles.catTitle}>{meta.label}</Text>

          {/* Service list */}
          {services.map((service) => {
            const bs = getBs(service.id);
            const isOffered = bs?.is_offered === true;
            const price = bs ? Number(bs.price ?? 0) : 0;
            const dur = bs?.duration_minutes ?? 30;

            return (
              <View
                key={service.id}
                style={[styles.serviceCard, !isOffered && styles.serviceCardOff]}
              >
                <View style={styles.serviceMainRow}>
                  <View style={styles.serviceInfo}>
                    <Text
                      style={[
                        styles.serviceName,
                        !isOffered && styles.serviceNameOff,
                      ]}
                      numberOfLines={1}
                    >
                      {service.name}
                    </Text>
                    {isOffered ? (
                      <View style={styles.serviceMetaRow}>
                        <TouchableOpacity
                          style={styles.priceChip}
                          onPress={() => {
                            if (bs) {
                              setKeypadTarget({
                                bsId: bs.id,
                                name: service.name,
                                currentPrice: price,
                              });
                              setKeypadOpen(true);
                            }
                          }}
                          activeOpacity={0.7}
                          delayPressIn={0}
                        >
                          <Text style={styles.priceChipText}>
                            ${price.toFixed(0)}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.durationChip}
                          onPress={() => {
                            if (!bs) return;
                            setDurationPickerTarget({
                              bsId: bs.id,
                              name: service.name,
                              currentDuration: dur,
                            });
                            setDurationPickerOpen(true);
                          }}
                          activeOpacity={0.7}
                          delayPressIn={0}
                        >
                          <Text style={styles.durationChipText}>{dur} min</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </View>

                  {bs ? (
                    <Switch
                      value={isOffered}
                      onValueChange={() => void toggleOffered(bs)}
                      trackColor={{ false: TRACK_OFF, true: colors.nova500 }}
                      thumbColor="#FFFFFF"
                      style={styles.switchCompact}
                    />
                  ) : (
                    <TouchableOpacity
                      style={styles.addBtn}
                      onPress={() => void addToMenu(service.id)}
                      activeOpacity={0.7}
                    >
                      <View pointerEvents="none">
                        <Plus size={14} color={NOVA_GREEN} strokeWidth={2.5} />
                      </View>
                      <Text style={styles.addBtnText}>Add</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })}

          {/* Create custom service */}
          <TouchableOpacity
            style={styles.createBtn}
            onPress={() => {
              setNewCategory(activeCategory);
              setCreateOpen(true);
            }}
            activeOpacity={0.7}
          >
            <View pointerEvents="none" style={{ marginRight: 6 }}>
              <Plus size={16} color={MUTED} strokeWidth={2} />
            </View>
            <Text style={styles.createBtnText}>Create custom service</Text>
          </TouchableOpacity>
        </ScrollView>

        <PriceKeypad
          open={keypadOpen}
          target={keypadTarget}
          onClose={() => setKeypadOpen(false)}
          onSave={(bsId, val) => {
            void updatePrice(bsId, val);
            setKeypadOpen(false);
          }}
        />

        <DurationPicker
          open={durationPickerOpen}
          target={durationPickerTarget}
          onClose={() => setDurationPickerOpen(false)}
          onSave={(bsId, dur) => {
            void updateDuration(bsId, dur);
            setDurationPickerOpen(false);
          }}
        />

        <CreateServiceModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          name={newName}
          setName={setNewName}
          price={newPrice}
          setPrice={setNewPrice}
          duration={newDuration}
          setDuration={setNewDuration}
          category={activeCategory || newCategory}
          setCategory={setNewCategory}
          showCategoryPicker={false}
          onSubmit={() => void createService()}
          isPending={creating}
        />
      </SafeAreaView>
    );
  }

  // ── Render: Category overview ─────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader onBack={() => navigation.goBack()} title="My Services" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Category cards */}
        {activeCategories.map((cat) => {
          const meta = CATEGORY_META[cat] || CATEGORY_META.other;
          const services = categoryGroups[cat];
          const offeredInCat = services.filter((s) => {
            const bs = getBs(s.id);
            return bs?.is_offered;
          }).length;

          return (
            <TouchableOpacity
              key={cat}
              style={styles.catCard}
              onPress={() => setActiveCategory(cat)}
              activeOpacity={0.75}
            >
              <View style={styles.catInfo}>
                <Text style={styles.catCardTitle}>{meta.label}</Text>
                <Text style={styles.catCardSub}>
                  {offeredInCat} of {services.length}
                </Text>
              </View>
              <View pointerEvents="none">
                <ChevronRight size={18} color={colors.textTertiary} strokeWidth={2} />
              </View>
            </TouchableOpacity>
          );
        })}

        {/* Create custom service */}
        <TouchableOpacity
          style={styles.createBtn}
          onPress={() => {
            setNewCategory("hair");
            setCreateOpen(true);
          }}
          activeOpacity={0.7}
        >
          <View pointerEvents="none" style={{ marginRight: 6 }}>
            <Plus size={16} color={MUTED} strokeWidth={2} />
          </View>
          <Text style={styles.createBtnText}>Create custom service</Text>
        </TouchableOpacity>

        {activeCategories.length === 0 ? (
          <View style={styles.emptyWrap}>
            <View pointerEvents="none">
              <Scissors size={32} color={colors.textTertiary} strokeWidth={2} />
            </View>
            <Text style={styles.emptyTitle}>
              No services configured for this shop yet.
            </Text>
            <Text style={styles.emptySub}>
              Ask your shop owner to add services in settings.
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <CreateServiceModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        name={newName}
        setName={setNewName}
        price={newPrice}
        setPrice={setNewPrice}
        duration={newDuration}
        setDuration={setNewDuration}
        category={newCategory}
        setCategory={setNewCategory}
        showCategoryPicker
        onSubmit={() => void createService()}
        isPending={creating}
      />
    </SafeAreaView>
  );
}

// ── Screen Header ─────────────────────────────────────────────────────────────

function ScreenHeader({
  onBack,
  title,
}: {
  onBack: () => void;
  title: string;
}) {
  return (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={onBack}
        style={styles.headerBackBtn}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        activeOpacity={0.7}
      >
        <View pointerEvents="none">
          <ChevronLeft size={24} color={LABEL} strokeWidth={2} />
        </View>
      </TouchableOpacity>
      <View style={styles.headerTitleWrap} pointerEvents="none">
        <Text style={styles.headerTitle}>{title}</Text>
      </View>
      <View style={styles.headerSpacer} />
    </View>
  );
}

// ── Price Keypad ──────────────────────────────────────────────────────────────

function PriceKeypad({
  open,
  target,
  onClose,
  onSave,
}: {
  open: boolean;
  target: { bsId: string; name: string; currentPrice: number } | null;
  onClose: () => void;
  onSave: (bsId: string, price: number) => void;
}) {
  const [input, setInput] = useState("");

  useEffect(() => {
    if (open) setInput("");
  }, [open]);

  const display = input || "0";
  const parsed = parseFloat(input);
  const valid = !isNaN(parsed) && parsed > 0;

  const handleKey = (key: string) => {
    if (key === "del") {
      setInput((p) => p.slice(0, -1));
      return;
    }
    if (key === ".") {
      if (input.includes(".")) return;
      setInput((p) => p + ".");
      return;
    }
    if (input.length >= 6) return;
    setInput((p) => p + key);
  };

  const KEYS = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    [".", "0", "del"],
  ];

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={kp.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={kp.sheet}>
          <View style={kp.handle} />

          <View style={kp.headerRow}>
            <Text style={kp.serviceName} numberOfLines={1}>
              {target?.name}
            </Text>
            <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
              <Text style={kp.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>

          {/* Display */}
          <View style={kp.displayRow}>
            <Text style={kp.dollarSign}>$</Text>
            <Text style={[kp.displayValue, input ? kp.displayActive : null]}>
              {display}
            </Text>
          </View>
          <Text style={kp.currentLabel}>
            Currently ${target?.currentPrice ?? 0}
          </Text>

          {/* Keys */}
          <View style={kp.grid}>
            {KEYS.flat().map((key) => (
              <TouchableOpacity
                key={key}
                style={kp.key}
                onPress={() => handleKey(key)}
                activeOpacity={0.7}
                delayPressIn={0}
              >
                {key === "del" ? (
                  <View pointerEvents="none">
                    <Delete size={20} color={LABEL} strokeWidth={2} />
                  </View>
                ) : (
                  <Text style={kp.keyText}>{key}</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>

          {/* Save */}
          <TouchableOpacity
            style={[kp.saveBtn, !valid && kp.saveBtnDisabled]}
            onPress={() => target && valid && onSave(target.bsId, parsed)}
            disabled={!valid}
            activeOpacity={0.85}
          >
            <Text style={[kp.saveBtnText, !valid && kp.saveBtnTextDisabled]}>
              {valid ? `Save — $${display}` : "Enter a price"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const kp = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.obsidian700,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.white15,
    marginTop: 8,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  serviceName: { fontSize: 14, fontFamily: "Satoshi-Regular", color: MUTED, flex: 1, marginRight: 12 },
  cancelText: { fontSize: 14, fontFamily: "Satoshi-Regular", color: MUTED },
  displayRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "center",
    paddingTop: 16,
  },
  dollarSign: {
    fontSize: 36,
    fontWeight: "700",
    fontFamily: "Satoshi-Bold",
    color: colors.steel50,
    marginRight: 2,
  },
  displayValue: {
    fontSize: 36,
    fontWeight: "700",
    fontFamily: "Satoshi-Bold",
    color: colors.steel50,
  },
  displayActive: { color: LABEL },
  currentLabel: {
    textAlign: "center",
    fontSize: 12,
    color: DIM,
    marginTop: 8,
    marginBottom: 16,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 20,
    gap: 8,
  },
  key: {
    width: "31%",
    height: 56,
    borderRadius: 12,
    backgroundColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  keyText: { fontSize: 20, fontWeight: "500", fontFamily: "Satoshi-Medium", color: LABEL },
  saveBtn: {
    marginHorizontal: 20,
    marginTop: 12,
    height: 52,
    borderRadius: 12,
    backgroundColor: NOVA_GREEN,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnDisabled: { backgroundColor: CARD_BG },
  saveBtnText: { fontSize: 15, fontWeight: "600", fontFamily: "Satoshi-Medium", color: BG },
  saveBtnTextDisabled: { color: DIM },
});

// ── Duration Picker ───────────────────────────────────────────────────────────

const WHEEL_ITEM_H = 48;
const WHEEL_VISIBLE = 5;
const WHEEL_H = WHEEL_ITEM_H * WHEEL_VISIBLE;
const WHEEL_PAD = WHEEL_ITEM_H * Math.floor(WHEEL_VISIBLE / 2);

// 5 min → 180 min in 5-min steps
const DURATION_VALUES: number[] = (() => {
  const out: number[] = [];
  for (let m = 5; m <= 180; m += 5) out.push(m);
  return out;
})();

function DurationPicker({
  open,
  target,
  onClose,
  onSave,
}: {
  open: boolean;
  target: { bsId: string; name: string; currentDuration: number } | null;
  onClose: () => void;
  onSave: (bsId: string, duration: number) => void;
}) {
  const [selected, setSelected] = useState(30);
  const scrollRef = useRef<ScrollView>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (open && target) {
      // Snap to nearest 5-min value
      const snapped = Math.round(target.currentDuration / 5) * 5;
      const clamped = Math.max(5, Math.min(180, snapped));
      setSelected(clamped);
      mountedRef.current = false;
    }
  }, [open, target]);

  // Scroll to initial position after layout
  const onLayout = useCallback(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    const idx = DURATION_VALUES.indexOf(selected);
    if (idx >= 0 && scrollRef.current) {
      scrollRef.current.scrollTo({ y: idx * WHEEL_ITEM_H, animated: false });
    }
  }, [selected]);

  const onScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      const y = e.nativeEvent.contentOffset.y;
      const idx = Math.round(y / WHEEL_ITEM_H);
      const clamped = Math.max(0, Math.min(DURATION_VALUES.length - 1, idx));
      setSelected(DURATION_VALUES[clamped]);
    },
    [],
  );

  const formatLabel = (m: number): string => {
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
  };

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={dp.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={dp.sheet}>
          <View style={dp.handle} />

          <View style={dp.headerRow}>
            <Text style={dp.serviceName} numberOfLines={1}>
              {target?.name}
            </Text>
            <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
              <Text style={dp.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>

          {/* Selected value display */}
          <Text style={dp.selectedDisplay}>{formatLabel(selected)}</Text>
          <Text style={dp.currentLabel}>
            Currently {target?.currentDuration ?? 30} min
          </Text>

          {/* Scroll wheel */}
          <View style={dp.wheelWrap}>
            {/* Selection highlight band */}
            <View pointerEvents="none" style={dp.highlightBand} />
            <ScrollView
              ref={scrollRef}
              style={dp.wheel}
              contentContainerStyle={{
                paddingVertical: WHEEL_PAD,
              }}
              snapToInterval={WHEEL_ITEM_H}
              decelerationRate="fast"
              showsVerticalScrollIndicator={false}
              onScroll={onScroll}
              scrollEventThrottle={16}
              onLayout={onLayout}
            >
              {DURATION_VALUES.map((m) => {
                const isSel = m === selected;
                return (
                  <View key={m} style={dp.wheelItem}>
                    <Text
                      style={[
                        dp.wheelText,
                        isSel && dp.wheelTextSelected,
                      ]}
                    >
                      {formatLabel(m)}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          </View>

          <TouchableOpacity
            style={dp.saveBtn}
            onPress={() => target && onSave(target.bsId, selected)}
            activeOpacity={0.85}
          >
            <Text style={dp.saveBtnText}>Save — {formatLabel(selected)}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const dp = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.obsidian700,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.white15,
    marginTop: 8,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  serviceName: { fontSize: 14, color: MUTED, flex: 1, marginRight: 12 },
  cancelText: { fontSize: 14, color: MUTED },
  selectedDisplay: {
    textAlign: "center",
    fontSize: 32,
    fontWeight: "700",
    fontFamily: "Satoshi-Bold",
    color: LABEL,
    marginTop: 16,
  },
  currentLabel: {
    textAlign: "center",
    fontSize: 12,
    color: DIM,
    marginTop: 6,
    marginBottom: 12,
  },
  wheelWrap: {
    height: WHEEL_H,
    marginHorizontal: 40,
    overflow: "hidden",
    position: "relative",
  },
  highlightBand: {
    position: "absolute",
    top: WHEEL_ITEM_H * 2,
    left: 0,
    right: 0,
    height: WHEEL_ITEM_H,
    borderRadius: 12,
    backgroundColor: BORDER,
    borderTopWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: colors.white10,
  },
  wheel: {
    flex: 1,
  },
  wheelItem: {
    height: WHEEL_ITEM_H,
    alignItems: "center",
    justifyContent: "center",
  },
  wheelText: {
    fontSize: 18,
    fontWeight: "500",
    color: colors.steel35,
  },
  wheelTextSelected: {
    color: LABEL,
    fontWeight: "600",
    fontSize: 20,
  },
  saveBtn: {
    marginHorizontal: 20,
    marginTop: 16,
    height: 52,
    borderRadius: 12,
    backgroundColor: NOVA_GREEN,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: { fontSize: 15, fontWeight: "600", fontFamily: "Satoshi-Medium", color: BG },
});

// ── Create Service Modal ──────────────────────────────────────────────────────

function CreateServiceModal({
  open,
  onClose,
  name,
  setName,
  price,
  setPrice,
  duration,
  setDuration,
  category,
  setCategory,
  showCategoryPicker,
  onSubmit,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  setName: (v: string) => void;
  price: string;
  setPrice: (v: string) => void;
  duration: number;
  setDuration: (v: number) => void;
  category: string;
  setCategory: (v: string) => void;
  showCategoryPicker: boolean;
  onSubmit: () => void;
  isPending: boolean;
}) {
  const canSave =
    name.trim().length > 0 && price.trim().length > 0 && !isPending;

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={cm.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={cm.sheet}>
          <View style={cm.handle} />
          <Text style={cm.title}>New service</Text>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Name */}
            <Text style={cm.fieldLabel}>Service name</Text>
            <TextInput
              style={cm.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Signature Fade"
              placeholderTextColor={colors.textTertiary}
            />

            {/* Price */}
            <Text style={cm.fieldLabel}>Price ($)</Text>
            <TextInput
              style={cm.input}
              value={price}
              onChangeText={setPrice}
              placeholder="0"
              placeholderTextColor={colors.textTertiary}
              keyboardType="decimal-pad"
            />

            {/* Duration */}
            <Text style={cm.fieldLabel}>Duration</Text>
            <View style={cm.durRow}>
              {DURATION_OPTIONS.map((d) => {
                const sel = duration === d;
                return (
                  <TouchableOpacity
                    key={d}
                    style={[cm.durPill, sel && cm.durPillSelected]}
                    onPress={() => setDuration(d)}
                    activeOpacity={0.8}
                  >
                    <Text style={[cm.durText, sel && cm.durTextSelected]}>
                      {d}m
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Category */}
            {showCategoryPicker ? (
              <>
                <Text style={cm.fieldLabel}>Category</Text>
                <View style={cm.catRow}>
                  {Object.entries(CATEGORY_META).map(([key, meta]) => {
                    const sel = category === key;
                    return (
                      <TouchableOpacity
                        key={key}
                        style={[cm.catPill, sel && cm.catPillSelected]}
                        onPress={() => setCategory(key)}
                        activeOpacity={0.8}
                      >
                        <Text style={[cm.catPillText, sel && cm.catPillTextSel]}>
                          {meta.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            ) : null}

            <TouchableOpacity
              style={[cm.submitBtn, !canSave && cm.submitBtnDisabled]}
              onPress={onSubmit}
              disabled={!canSave}
              activeOpacity={0.85}
            >
              <Text style={cm.submitBtnText}>
                {isPending ? "Creating…" : "Create Service"}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const cm = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.obsidian700,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxHeight: "80%",
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.white25,
    marginTop: 12,
    marginBottom: 16,
  },
  title: { fontSize: 18, fontWeight: "600", fontFamily: "Satoshi-Medium", color: LABEL, marginBottom: 16 },
  fieldLabel: { fontSize: 12, fontFamily: "Satoshi-Regular", color: MUTED, marginBottom: 6, marginTop: 14 },
  input: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.white10,
    backgroundColor: CARD_BG,
    color: LABEL,
    fontSize: 14,
    paddingHorizontal: 14,
  },
  durRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  durPill: {
    flex: 1,
    minWidth: 48,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  durPillSelected: {
    backgroundColor: colors.nova15,
    borderColor: colors.nova30,
  },
  durText: { fontSize: 13, fontWeight: "500", fontFamily: "Satoshi-Medium", color: MUTED },
  durTextSelected: { color: NOVA_GREEN },
  catRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  catPill: {
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  catPillSelected: {
    backgroundColor: colors.nova15,
    borderColor: colors.nova30,
  },
  catPillText: { fontSize: 12, fontWeight: "500", fontFamily: "Satoshi-Medium", color: MUTED },
  catPillTextSel: { color: NOVA_GREEN },
  submitBtn: {
    marginTop: 24,
    height: 48,
    borderRadius: 10,
    backgroundColor: NOVA_GREEN,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { fontSize: 15, fontWeight: "600", fontFamily: "Satoshi-Medium", color: BG },
});

// ── Main Styles ───────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    height: 52,
  },
  headerBackBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  headerTitleWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1,
  },
  headerTitle: { fontSize: 17, fontWeight: "600", fontFamily: "Satoshi-Medium", color: LABEL },
  headerSpacer: { width: 44, zIndex: 2 },
  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center" },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 40 },
  subtitle: { fontSize: 12, fontFamily: "Satoshi-Regular", color: DIM, marginBottom: 16 },

  // Stats
  statsRow: { flexDirection: "row", gap: 8, marginBottom: 20 },
  statCard: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  statValue: { fontSize: 18, fontWeight: "700", fontFamily: "Satoshi-Bold", color: LABEL },
  statLabel: { fontSize: 11, fontFamily: "Satoshi-Regular", color: DIM, marginTop: 2 },

  // Category cards
  catCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 6,
  },
  catInfo: { flex: 1 },
  catCardTitle: { fontSize: 16, fontWeight: "600", fontFamily: "Satoshi-Medium", color: LABEL },
  catCardSub: { fontSize: 13, fontFamily: "Satoshi-Regular", color: DIM, marginTop: 2 },

  // Category detail
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    paddingVertical: 4,
  },
  backText: { fontSize: 14, fontWeight: "500", fontFamily: "Satoshi-Medium", color: MUTED },
  catTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: LABEL,
    letterSpacing: -0.3,
  },
  catSub: { fontSize: 12, color: DIM, marginTop: 4, marginBottom: 16 },

  // Service cards
  serviceCard: {
    borderRadius: 12,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    marginBottom: 8,
  },
  serviceCardOff: { opacity: 0.5 },
  serviceMainRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  serviceInfo: { flex: 1, marginRight: 12 },
  serviceName: { fontSize: 15, fontWeight: "500", fontFamily: "Satoshi-Medium", color: LABEL },
  serviceNameOff: { color: colors.textTertiary },
  serviceMetaRow: { flexDirection: "row", alignItems: "center", marginTop: 10, gap: 10 },
  priceChip: {
    backgroundColor: colors.nova10,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.nova20,
  },
  priceChipText: {
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: NOVA_GREEN,
  },
  durationChip: {
    backgroundColor: BORDER,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },
  durationChipText: {
    fontSize: 16,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: MUTED,
  },
  switchCompact: { transform: [{ scale: 0.85 }] },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.nova20,
    backgroundColor: colors.nova06,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  addBtnText: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: NOVA_GREEN,
    marginLeft: 4,
  },

  // Create button
  createBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.white12,
    borderStyle: "dashed",
    paddingVertical: 14,
    marginTop: 8,
  },
  createBtnText: { fontSize: 14, fontWeight: "500", fontFamily: "Satoshi-Medium", color: MUTED },

  // Empty
  emptyWrap: { alignItems: "center", paddingTop: 48 },
  emptyTitle: {
    fontSize: 14,
    color: DIM,
    marginTop: 12,
    textAlign: "center",
  },
  emptySub: {
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 4,
    textAlign: "center",
  },
});
