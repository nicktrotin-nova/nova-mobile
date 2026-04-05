import { useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ChevronLeft } from "lucide-react-native";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import type { MoreStackParamList } from "../navigation/MoreStack";
import { colors, BG, NOVA_GREEN, MUTED, DIM, LABEL, CARD_BG } from "../theme/colors";
import { useScreenData } from "../hooks/useScreenData";

const BORDER = colors.borderMedium;

const BIO_MAX = 160;

type Baseline = {
  displayName: string;
  bio: string;
  instagram: string;
  avatarUrl: string | null;
};

export default function MyProfileScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<MoreStackParamList>>();
  const insets = useSafeAreaInsets();
  const { barberId, user } = useAuth();

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [instagram, setInstagram] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [legalName, setLegalName] = useState("");
  const baseline = useRef<Baseline | null>(null);

  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [showSaved, setShowSaved] = useState(false);

  const load = useCallback(async () => {
    if (!barberId) return;

    let q = await supabase
      .from("barbers")
      .select("name, display_name, bio, instagram_handle, avatar_url")
      .eq("id", barberId)
      .maybeSingle();

    if (q.error && /instagram_handle|column/.test(q.error.message)) {
      q = await supabase
        .from("barbers")
        .select("name, display_name, bio, avatar_url")
        .eq("id", barberId)
        .maybeSingle();
    }

    const row = q.data as {
      name?: string;
      display_name?: string | null;
      bio?: string | null;
      instagram_handle?: string | null;
      avatar_url?: string | null;
    } | null;

    if (!q.error && row) {
      const dn = (row.display_name ?? "").trim();
      const bn = (row.name ?? "").trim();
      const bi = (row.bio ?? "").trim();
      const ig = (row.instagram_handle ?? "").replace(/^@+/, "").trim();
      const av = row.avatar_url?.trim() || null;

      setDisplayName(dn);
      setLegalName(bn);
      setBio(bi);
      setInstagram(ig);
      setAvatarUrl(av);
      baseline.current = { displayName: dn, bio: bi, instagram: ig, avatarUrl: av };
    } else {
      baseline.current = { displayName: "", bio: "", instagram: "", avatarUrl: null };
    }
  }, [barberId]);

  const { loading } = useScreenData(load, [load], !!barberId);

  const normalizedIg = instagram.replace(/^@+/, "").trim();
  const dirty =
    baseline.current != null &&
    (displayName.trim() !== (baseline.current.displayName ?? "").trim() ||
      bio.trim() !== (baseline.current.bio ?? "").trim() ||
      normalizedIg !== (baseline.current.instagram ?? ""));

  const displayInitial = (
    (displayName.trim() || legalName.trim() || "?")[0] || "?"
  ).toUpperCase();

  // ── Photo upload ──────────────────────────────────────────────────────────

  const pickAndUploadPhoto = async () => {
    if (!barberId || uploadingPhoto) return;

    const ImagePicker = await import("expo-image-picker");
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Photo access",
        "Allow photo library access in Settings to change your profile photo.",
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });

    if (result.canceled || !result.assets?.[0]?.uri) return;

    const uri = result.assets[0].uri;
    setUploadingPhoto(true);
    try {
      const path = `barber-${barberId}-${Date.now()}.jpg`;
      const response = await fetch(uri);
      const buffer = await response.arrayBuffer();

      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, buffer, { contentType: "image/jpeg", upsert: false });

      if (upErr) {
        Alert.alert("Upload failed", upErr.message);
        return;
      }

      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);

      const { error: dbErr } = await supabase
        .from("barbers")
        .update({ avatar_url: pub.publicUrl })
        .eq("id", barberId);

      if (dbErr) {
        Alert.alert("Could not save photo", dbErr.message);
        return;
      }

      setAvatarUrl(pub.publicUrl);
      if (baseline.current) {
        baseline.current = { ...baseline.current, avatarUrl: pub.publicUrl };
      }
      flash();
    } catch (e) {
      Alert.alert(
        "Photo error",
        e instanceof Error ? e.message : "Something went wrong",
      );
    } finally {
      setUploadingPhoto(false);
    }
  };

  // ── Save ──────────────────────────────────────────────────────────────────

  const flash = () => {
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 2000);
  };

  const onSave = async () => {
    if (!barberId || !dirty || saving) return;
    setSaving(true);
    try {
      const payload: Record<string, string | null> = {
        display_name: displayName.trim() || null,
        bio: bio.trim() || null,
        instagram_handle: normalizedIg || null,
      };

      const { error } = await supabase
        .from("barbers")
        .update(payload)
        .eq("id", barberId);

      if (error) {
        const noIg =
          error.message.includes("instagram_handle") ||
          error.message.includes("Could not find");
        if (noIg) {
          const retry = await supabase
            .from("barbers")
            .update({ display_name: payload.display_name, bio: payload.bio })
            .eq("id", barberId);
          if (retry.error) {
            Alert.alert("Could not save", retry.error.message);
            return;
          }
        } else {
          Alert.alert("Could not save", error.message);
          return;
        }
      }

      baseline.current = {
        displayName: displayName.trim(),
        bio: bio.trim(),
        instagram: normalizedIg,
        avatarUrl,
      };
      setInstagram(normalizedIg);
      flash();
    } finally {
      setSaving(false);
    }
  };

  const email = user?.email ?? "";

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={NOVA_GREEN} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            activeOpacity={0.7}
          >
            <View pointerEvents="none">
              <ChevronLeft size={24} color={LABEL} strokeWidth={2} />
            </View>
          </TouchableOpacity>
          <View style={styles.headerTitleWrap} pointerEvents="none">
            <Text style={styles.headerTitle}>My Profile</Text>
          </View>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: 100 + insets.bottom },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Avatar */}
          <View style={styles.avatarBlock}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarImg} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarInitial}>{displayInitial}</Text>
              </View>
            )}
            <TouchableOpacity
              onPress={() => void pickAndUploadPhoto()}
              disabled={uploadingPhoto}
              hitSlop={{ top: 8, bottom: 8 }}
              activeOpacity={0.7}
            >
              <Text style={styles.changePhoto}>
                {uploadingPhoto ? "Uploading…" : "Change photo"}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Display Name */}
          <FieldCard label="Display Name">
            <TextInput
              value={displayName}
              onChangeText={setDisplayName}
              style={styles.fieldInput}
              placeholder="Your professional name"
              placeholderTextColor={colors.textTertiary}
            />
          </FieldCard>

          {/* Bio */}
          <FieldCard label="Bio" right={`${bio.length}/${BIO_MAX}`}>
            <TextInput
              value={bio}
              onChangeText={(t) => {
                if (t.length <= BIO_MAX) setBio(t);
              }}
              style={[styles.fieldInput, styles.fieldInputMulti]}
              placeholder="Tell clients about yourself..."
              placeholderTextColor={colors.textTertiary}
              multiline
              textAlignVertical="top"
            />
          </FieldCard>

          {/* Instagram */}
          <FieldCard label="Instagram">
            <View style={styles.igRow}>
              <Text style={styles.igAt}>@</Text>
              <TextInput
                value={instagram}
                onChangeText={(t) => setInstagram(t.replace("@", ""))}
                style={[styles.fieldInput, styles.fieldInputIg]}
                placeholder="yourhandle"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </FieldCard>

          {/* Email */}
          <FieldCard label="Email">
            <Text style={styles.emailText}>{email || "—"}</Text>
            <Text style={styles.emailHint}>Contact support to change</Text>
          </FieldCard>

          {showSaved ? (
            <Text style={styles.savedHint}>Saved</Text>
          ) : null}
        </ScrollView>

        {/* Save button */}
        <View
          style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}
        >
          <TouchableOpacity
            style={[styles.saveBtn, (!dirty || saving) && styles.saveBtnDisabled]}
            onPress={() => void onSave()}
            disabled={!dirty || saving}
            activeOpacity={0.9}
          >
            <Text style={styles.saveBtnText}>
              {saving ? "Saving…" : "Save Changes"}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Field Card ────────────────────────────────────────────────────────────────

function FieldCard({
  label,
  right,
  children,
}: {
  label: string;
  right?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={fc.card}>
      <View style={fc.labelRow}>
        <Text style={fc.label}>{label}</Text>
        {right ? <Text style={fc.right}>{right}</Text> : null}
      </View>
      {children}
    </View>
  );
}

const fc = StyleSheet.create({
  card: {
    borderRadius: 12,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    marginBottom: 10,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: MUTED,
  },
  right: {
    fontSize: 12,
    fontFamily: "Satoshi-Regular",
    color: DIM,
  },
});

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  keyboard: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    height: 52,
  },
  backBtn: {
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
  loadingWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 8 },

  // Avatar
  avatarBlock: { alignItems: "center", marginBottom: 28 },
  avatarImg: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: colors.white10,
  },
  avatarFallback: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.nova12,
    borderWidth: 2,
    borderColor: colors.nova20,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    fontSize: 34,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: NOVA_GREEN,
  },
  changePhoto: {
    marginTop: 10,
    fontSize: 14,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: NOVA_GREEN,
  },

  // Field inputs
  fieldInput: {
    fontSize: 15,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: LABEL,
    padding: 0,
  },
  fieldInputMulti: {
    height: 72,
  },
  igRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  igAt: {
    fontSize: 15,
    fontFamily: "Satoshi-Regular",
    color: DIM,
    marginRight: 2,
  },
  fieldInputIg: {
    flex: 1,
  },

  // Email
  emailText: {
    fontSize: 15,
    fontFamily: "Satoshi-Regular",
    color: DIM,
  },
  emailHint: {
    fontSize: 12,
    fontFamily: "Satoshi-Regular",
    color: colors.textTertiary,
    marginTop: 4,
  },

  // Saved
  savedHint: {
    marginTop: 16,
    textAlign: "center",
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: NOVA_GREEN,
  },

  // Footer
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: BG,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  saveBtn: {
    width: "100%",
    height: 52,
    borderRadius: 12,
    backgroundColor: NOVA_GREEN,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnDisabled: { opacity: 0.35 },
  saveBtnText: { fontSize: 15, fontWeight: "600", fontFamily: "Satoshi-Medium", color: BG },
});
