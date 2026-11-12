import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar } from "../components/avatar";
import { Alert } from "../lib/alert";
import { useAuth } from "../lib/auth";
import { describeRecipeError, useRecipes } from "./recipe-store";

const AVATAR_SIZE = 512; // pixels; plenty for a profile picture, small to upload

// Lets the user pick (or take) a photo, then crops it to a centred square,
// shrinks it and returns it as base64 JPEG. Null if they cancelled.
async function pickProfilePicture(source: "library" | "camera"): Promise<string | null> {
  if (source === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Camera access needed", "Allow camera access in Settings to take a profile picture.");
      return null;
    }
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    allowsEditing: true, // lets phones crop it themselves first
    aspect: [1, 1],
    quality: 1,
  };
  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0];
  const image = ImageManipulator.ImageManipulator.manipulate(asset.uri);
  // The web picker (and some Androids) don't crop, so make it square here.
  if (asset.width && asset.height && asset.width !== asset.height) {
    const side = Math.min(asset.width, asset.height);
    image.crop({
      originX: Math.floor((asset.width - side) / 2),
      originY: Math.floor((asset.height - side) / 2),
      width: side,
      height: side,
    });
  }
  if (!asset.width || Math.min(asset.width, asset.height) > AVATAR_SIZE) {
    image.resize({ width: AVATAR_SIZE });
  }
  const rendered = await image.renderAsync();
  const saved = await rendered.saveAsync({
    format: ImageManipulator.SaveFormat.JPEG,
    compress: 0.8,
    base64: true,
  });
  return saved.base64 ?? null;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

export default function AccountScreen() {
  const { user, signOut, setAvatar } = useAuth();
  const { recipes, savedRecipes } = useRecipes();
  const [busy, setBusy] = useState<null | "photo" | "signout">(null);

  if (!user) return null; // signing out — the layout is about to swap screens

  const publishedCount = recipes.filter((r) => r.isPublic).length;

  const changePhoto = async (source: "library" | "camera") => {
    try {
      const base64 = await pickProfilePicture(source);
      if (!base64) return;
      setBusy("photo");
      await setAvatar(base64);
    } catch (err) {
      Alert.alert("Couldn't update your picture", describeRecipeError(err));
    } finally {
      setBusy(null);
    }
  };

  const removePhoto = () =>
    Alert.alert("Remove profile picture?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          setBusy("photo");
          try {
            await setAvatar(null);
          } catch (err) {
            Alert.alert("Couldn't remove your picture", describeRecipeError(err));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);

  const confirmSignOut = () =>
    Alert.alert("Sign out?", `You're signed in as ${user.username}.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: () => {
          setBusy("signout");
          signOut();
        },
      },
    ]);

  return (
    <SafeAreaView style={styles.safeArea} edges={["left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.profile}>
          <View>
            <Avatar username={user.username} avatarUrl={user.avatarUrl} size={120} />
            {busy === "photo" && (
              <View style={styles.avatarBusy}>
                <ActivityIndicator color="#FFFFFF" />
              </View>
            )}
          </View>
          <Text style={styles.username}>{user.username}</Text>
          {user.role === "admin" && <Text style={styles.roleBadge}>Admin</Text>}

          <View style={styles.photoButtons}>
            <TouchableOpacity
              style={styles.photoButton}
              onPress={() => changePhoto("library")}
              disabled={busy !== null}
            >
              <Text style={styles.photoButtonText}>
                {user.avatarUrl ? "Change Photo" : "Add Photo"}
              </Text>
            </TouchableOpacity>
            {Platform.OS !== "web" && (
              <TouchableOpacity
                style={styles.photoButton}
                onPress={() => changePhoto("camera")}
                disabled={busy !== null}
              >
                <Text style={styles.photoButtonText}>Take Photo</Text>
              </TouchableOpacity>
            )}
          </View>
          {user.avatarUrl && (
            <TouchableOpacity onPress={removePhoto} disabled={busy !== null} hitSlop={8}>
              <Text style={styles.removeText}>Remove photo</Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.sectionHeading}>Account</Text>
        <View style={styles.card}>
          <InfoRow label="Username" value={user.username} />
          <InfoRow label="Email" value={user.email} />
          <InfoRow label="Account type" value={user.role === "admin" ? "Admin" : "User"} />
          <InfoRow label="Member since" value={formatDate(user.createdAt)} />
          <InfoRow label="User ID" value={`#${user.id}`} last />
        </View>

        <Text style={styles.sectionHeading}>Activity</Text>
        <View style={styles.stats}>
          <Stat value={recipes.length} label="My recipes" />
          <Stat value={publishedCount} label="Published" />
          <Stat value={savedRecipes.length} label="Saved" />
        </View>

        <TouchableOpacity
          style={styles.signOutButton}
          onPress={confirmSignOut}
          disabled={busy !== null}
          accessibilityRole="button"
        >
          <Text style={styles.signOutText}>{busy === "signout" ? "Signing out..." : "Sign Out"}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.infoRow, !last && styles.infoRowBorder]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} selectable numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#FAF7F2",
  },
  container: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
  },
  profile: {
    alignItems: "center",
    marginBottom: 24,
  },
  avatarBusy: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 60,
    backgroundColor: "rgba(43, 33, 24, 0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  username: {
    fontSize: 24,
    fontWeight: "700",
    color: "#2B2118",
    marginTop: 12,
  },
  roleBadge: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: "700",
    color: "#8A5A2E",
    backgroundColor: "#F3E4D3",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: "hidden",
  },
  photoButtons: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  photoButton: {
    borderWidth: 1,
    borderColor: "#D97B4F",
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  photoButtonText: {
    color: "#D97B4F",
    fontWeight: "700",
    fontSize: 15,
  },
  removeText: {
    color: "#8A7A68",
    fontSize: 14,
    marginTop: 12,
  },
  sectionHeading: {
    fontSize: 14,
    fontWeight: "700",
    color: "#8A7A68",
    textTransform: "uppercase",
    marginBottom: 8,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E0D5C7",
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    gap: 16,
  },
  infoRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: "#EFE8DE",
  },
  infoLabel: {
    fontSize: 15,
    color: "#8A7A68",
  },
  infoValue: {
    fontSize: 15,
    fontWeight: "600",
    color: "#2B2118",
    flexShrink: 1,
    textAlign: "right",
  },
  stats: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 32,
  },
  stat: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E0D5C7",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  statValue: {
    fontSize: 22,
    fontWeight: "700",
    color: "#2B2118",
  },
  statLabel: {
    fontSize: 12,
    color: "#8A7A68",
    marginTop: 2,
  },
  signOutButton: {
    borderWidth: 1,
    borderColor: "#B04A3B",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  signOutText: {
    color: "#B04A3B",
    fontWeight: "700",
    fontSize: 16,
  },
});
