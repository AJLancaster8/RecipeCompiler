import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { apiUrl } from "../lib/recipe-api";

// Background colours for accounts without a picture, picked by username so
// each person keeps the same one.
const COLORS = ["#D97B4F", "#7A9E7E", "#8A6FB0", "#C9A227", "#4F8FB8", "#B85C7A"];

function colorFor(name: string) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
}

// A round profile picture, or the username's first letter if there isn't
// one (or it fails to load).
export function Avatar({
  username,
  avatarUrl,
  size = 40,
}: {
  username: string;
  avatarUrl: string | null | undefined;
  size?: number;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const round = { width: size, height: size, borderRadius: size / 2 };

  if (avatarUrl && failedUrl !== avatarUrl) {
    return (
      <Image
        source={{ uri: apiUrl(avatarUrl) }}
        style={[styles.image, round]}
        onError={() => setFailedUrl(avatarUrl)}
        accessibilityLabel={`${username}'s profile picture`}
      />
    );
  }

  return (
    <View style={[styles.fallback, round, { backgroundColor: colorFor(username) }]}>
      <Text style={[styles.initial, { fontSize: size * 0.45 }]}>
        {username.slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: "#E0D5C7",
  },
  fallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  initial: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
});
