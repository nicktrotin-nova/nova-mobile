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
} from "react-native";
import { useAuth } from "../contexts/AuthContext";

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            placeholderTextColor="#7BA7C2"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />

          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#7BA7C2"
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

          <Text style={styles.forgot}>Forgot password?</Text>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0D2137",
    justifyContent: "center",
    padding: 20,
  },
  inner: {
    flex: 1,
    justifyContent: "center",
  },
  card: {
    backgroundColor: "#FAFCFE",
    borderRadius: 14,
    padding: 24,
    width: "100%",
    maxWidth: 400,
    alignSelf: "center",
  },
  wordmark: {
    fontSize: 28,
    fontWeight: "500",
    color: "#0D2137",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: "#7BA7C2",
    textAlign: "center",
    marginTop: 4,
    marginBottom: 24,
  },
  error: {
    fontSize: 13,
    color: "#DC2626",
    textAlign: "center",
    marginBottom: 16,
  },
  input: {
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#DDE6EF",
    paddingHorizontal: 12,
    fontSize: 14,
    color: "#0D2137",
    marginBottom: 14,
    backgroundColor: "#fff",
  },
  button: {
    height: 44,
    borderRadius: 8,
    backgroundColor: "#0D2137",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 4,
  },
  buttonDisabled: {
    backgroundColor: "#163552",
  },
  buttonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "500",
  },
  forgot: {
    fontSize: 12,
    color: "#7BA7C2",
    textAlign: "center",
    marginTop: 16,
  },
});