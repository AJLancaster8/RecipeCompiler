import { ComponentRef, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/recipe-api";

type Mode = "signIn" | "register";

export default function SignInScreen() {
  const { signIn, register } = useAuth();
  const [mode, setMode] = useState<Mode>("signIn");
  // In sign-in mode this field takes a username OR an email.
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<ComponentRef<typeof TextInput>>(null);
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);
  const confirmRef = useRef<ComponentRef<typeof TextInput>>(null);

  const isRegister = mode === "register";

  const switchMode = () => {
    setMode(isRegister ? "signIn" : "register");
    setError(null);
    setConfirm("");
  };

  const submit = async () => {
    if (busy) return;
    const name = username.trim();
    const mail = email.trim();
    if (isRegister && (!name || !mail || !password)) {
      setError("Enter a username, email and password.");
      return;
    }
    if (!isRegister && (!name || !password)) {
      setError("Enter your username or email, and your password.");
      return;
    }
    if (isRegister && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      setError("Enter a valid email address.");
      return;
    }
    if (isRegister && password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (isRegister) await register(name, mail, password);
      else await signIn(name, password);
      // On success the layout swaps this screen for the app automatically.
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Something went wrong. Please try again.",
      );
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>Recipe Compiler</Text>
          <Text style={styles.subtitle}>
            {isRegister ? "Create an account" : "Sign in to your recipes"}
          </Text>

          {error && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Text style={styles.label}>
            {isRegister ? "Username" : "Username or email"}
          </Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            keyboardType={isRegister ? "default" : "email-address"}
            returnKeyType="next"
            onSubmitEditing={() =>
              isRegister ? emailRef.current?.focus() : passwordRef.current?.focus()
            }
            placeholder={isRegister ? "e.g. chef_alex" : ""}
            placeholderTextColor="#B5A898"
            editable={!busy}
          />

          {isRegister && (
            <>
              <Text style={styles.label}>Email</Text>
              <TextInput
                ref={emailRef}
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                keyboardType="email-address"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                placeholder="you@example.com"
                placeholderTextColor="#B5A898"
                editable={!busy}
              />
            </>
          )}

          <Text style={styles.label}>Password</Text>
          <TextInput
            ref={passwordRef}
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete={isRegister ? "new-password" : "current-password"}
            textContentType={isRegister ? "newPassword" : "password"}
            returnKeyType={isRegister ? "next" : "go"}
            onSubmitEditing={() =>
              isRegister ? confirmRef.current?.focus() : submit()
            }
            placeholder={isRegister ? "At least 8 characters" : ""}
            placeholderTextColor="#B5A898"
            editable={!busy}
          />

          {isRegister && (
            <>
              <Text style={styles.label}>Confirm password</Text>
              <TextInput
                ref={confirmRef}
                style={styles.input}
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="go"
                onSubmitEditing={submit}
                placeholderTextColor="#B5A898"
                editable={!busy}
              />
            </>
          )}

          <TouchableOpacity
            style={[styles.primaryButton, busy && { opacity: 0.7 }]}
            onPress={submit}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>
                {isRegister ? "Create Account" : "Sign In"}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={switchMode} disabled={busy}>
            <Text style={styles.switchText}>
              {isRegister
                ? "Already have an account? Sign in"
                : "New here? Create an account"}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#FAF7F2",
  },
  container: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 40,
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
  },
  title: {
    fontSize: 30,
    fontWeight: "700",
    color: "#2B2118",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    color: "#8A7A68",
    textAlign: "center",
    marginTop: 6,
    marginBottom: 28,
  },
  errorBanner: {
    backgroundColor: "#F6E3DE",
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 13,
    color: "#B04A3B",
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: "#8A7A68",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  input: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E0D5C7",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: "#2B2118",
    marginBottom: 16,
  },
  primaryButton: {
    backgroundColor: "#D97B4F",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 8,
    marginBottom: 20,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
  switchText: {
    fontSize: 15,
    color: "#D97B4F",
    fontWeight: "700",
    textAlign: "center",
  },
});
