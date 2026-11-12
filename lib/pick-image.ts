import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Alert } from "./alert";

export type PickedImage = {
  base64: string; // JPEG data, ready to upload
  uri: string; // local URI, for previewing before upload
};

// Lets the user pick a photo from their library or take one, crops it to
// `aspect` (centred), shrinks it to at most `maxWidth` pixels wide and
// returns it as JPEG. Null if they cancelled.
export async function pickImage({
  source,
  aspect,
  maxWidth,
}: {
  source: "library" | "camera";
  aspect: [number, number];
  maxWidth: number;
}): Promise<PickedImage | null> {
  if (source === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Camera access needed", "Allow camera access in Settings to take a photo.");
      return null;
    }
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    allowsEditing: true, // lets phones crop it themselves first
    aspect,
    quality: 1,
  };
  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0];
  const image = ImageManipulator.ImageManipulator.manipulate(asset.uri);
  let width = asset.width;
  // The web picker (and some Androids) don't crop, so crop to shape here.
  if (asset.width && asset.height) {
    const target = aspect[0] / aspect[1];
    const actual = asset.width / asset.height;
    if (Math.abs(actual - target) > 0.01) {
      const w = actual > target ? Math.round(asset.height * target) : asset.width;
      const h = actual > target ? asset.height : Math.round(asset.width / target);
      image.crop({
        originX: Math.floor((asset.width - w) / 2),
        originY: Math.floor((asset.height - h) / 2),
        width: w,
        height: h,
      });
      width = w;
    }
  }
  if (!width || width > maxWidth) image.resize({ width: maxWidth });
  const rendered = await image.renderAsync();
  const saved = await rendered.saveAsync({
    format: ImageManipulator.SaveFormat.JPEG,
    compress: 0.8,
    base64: true,
  });
  if (!saved.base64) return null;
  return { base64: saved.base64, uri: saved.uri };
}
