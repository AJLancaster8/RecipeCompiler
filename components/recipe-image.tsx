import { useState } from "react";
import { Image, ImageStyle, StyleProp } from "react-native";
import { apiUrl } from "../lib/recipe-api";

// A recipe's picture, filling the width at 4:3. Renders nothing if the
// recipe has no picture (or it fails to load).
export function RecipeImage({
  imageUrl,
  style,
}: {
  imageUrl: string | null | undefined;
  style?: StyleProp<ImageStyle>;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!imageUrl || failedUrl === imageUrl) return null;
  return (
    <Image
      source={{ uri: apiUrl(imageUrl) }}
      style={[{ width: "100%", aspectRatio: 4 / 3, borderRadius: 10, backgroundColor: "#E0D5C7" }, style]}
      onError={() => setFailedUrl(imageUrl)}
      accessibilityIgnoresInvertColors
    />
  );
}
