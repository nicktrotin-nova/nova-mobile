import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import { colors } from "../theme/colors";

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleForgotPassword = () => {
    Alert.prompt(
      "Reset password",
      "Enter your email address and we'll send you a reset link.",
      async (inputEmail) => {
        if (!inputEmail?.trim()) return;
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(
          inputEmail.trim()
        );
        if (resetError) {
          Alert.alert("Error", "Could not send reset email. Check the address and try again.");
        } else {
          Alert.alert("Check your inbox", "A password reset link has been sent if that email exists.");
        }
      },
      "plain-text",
      email
    );
  };

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    const { error: authError } = await signIn(email, password);
    if (authError) {
      setError("Incorrect email or password. Try again.");
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.inner}
      >
        <View style={styles.card}>
          <Text style={styles.wordmark}>Nova</Text>
          <Text style={styles.subtitle}>Sign in to your account</Text>

          {error && <Text style={styles.error}>{error}</Text>}

          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={colors.textGhost}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />

          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={colors.textGhost}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
          />

          <TouchableOpacity
            style={[styles.button, submitting && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.8}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={handleForgotPassword} activeOpacity={0.7}>
            <Text style={styles.forgot}>Forgot password?</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.obsidian900,
    justifyContent: "center",
    padding: 24,
  },
  inner: {
    flex: 1,
    justifyContent: "center",
  },
  card: {
    width: "100%",
    maxWidth: 400,
    alignSelf: "center",
  },
  wordmark: {
    fontSize: 36,
    fontWeight: "500",
    color: colors.nova500,
    textAlign: "center",
    fontFamily: "DMSerifText-Regular",
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Satoshi-Regular",
    color: colors.textSecondary,
    textAlign: "center",
    marginTop: 8,
    marginBottom: 32,
  },
  error: {
    fontSize: 13,
    fontFamily: "Satoshi-Regular",
    color: colors.error,
    textAlign: "center",
    marginBottom: 16,
  },
  input: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: "Satoshi-Regular",
    color: colors.textPrimary,
    marginBottom: 14,
    backgroundColor: colors.obsidian600,
  },
  button: {
    height: 48,
    borderRadius: 10,
    backgroundColor: colors.nova500,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: {
    backgroundColor: colors.nova600,
  },
  buttonText: {
    color: colors.textInverse,
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
  },
  forgot: {
    fontSize: 13,
    fontFamily: "Satoshi-Regular",
    color: colors.textTertiary,
    textAlign: "center",
    marginTop: 20,
  },
});