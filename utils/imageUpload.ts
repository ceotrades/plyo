import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../services/supabase';

// expo-image-picker with base64:true returns the image bytes directly as a
// base64 string (no data-URI prefix). This is the most reliable approach on
// both iOS and Android — it avoids fetch(localUri) which silently returns
// empty ArrayBuffers on iOS, and avoids expo-file-system which can fail to
// initialise its native EncodingType enum on some configurations.

export type PickedImage = {
  uri: string;   // local URI — use for <Image source> preview
  base64: string; // raw base64 — use for upload
};

// ── Picker (preview + upload data together) ───────────────────────────────────

/**
 * Opens the photo library and returns the local URI AND base64 bytes.
 * Returns null if the user cancels.
 * Use when you need to preview before uploading (e.g. folder cover).
 */
export async function pickImage(
  options?: { aspect?: [number, number] },
): Promise<PickedImage | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: options?.aspect ?? [1, 1],
    quality: 0.8,
    base64: true,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  if (!asset.base64) return null;
  return { uri: asset.uri, base64: asset.base64 };
}

// ── Uploader ──────────────────────────────────────────────────────────────────

/**
 * Uploads a base64-encoded image to Supabase Storage and returns the public URL.
 *
 * Path conventions (second segment must be the user_id for Storage RLS):
 *   avatars/{user_id}/avatar     → profile picture
 *   workouts/{user_id}/{id}      → workout cover
 *   folders/{user_id}/{id}       → folder cover
 */
export async function uploadBase64Image(base64: string, path: string): Promise<string> {
  const storagePath = `${path}.jpg`;

  // Decode base64 → Uint8Array (ArrayBufferView).
  // Supabase's XHR-based upload method handles ArrayBufferView correctly.
  const binaryString = atob(base64);
  const imageBytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    imageBytes[i] = binaryString.charCodeAt(i);
  }

  const { error: uploadError } = await supabase.storage
    .from('media')
    .upload(storagePath, imageBytes, {
      upsert: true,
      contentType: 'image/jpeg',
    });

  if (uploadError) throw new Error(uploadError.message);

  const { data: { publicUrl } } = supabase.storage
    .from('media')
    .getPublicUrl(storagePath);

  // Append a cache-busting timestamp so React Native's Image cache doesn't
  // serve a stale version when the same path is re-uploaded. Supabase Storage
  // ignores the query parameter and serves the current file regardless.
  return `${publicUrl}?v=${Date.now()}`;
}

// ── Combined: pick + upload in one call ───────────────────────────────────────

/**
 * Opens the photo library, picks and crops an image, uploads it to Supabase
 * Storage, and returns the public URL. Returns null if the user cancels.
 */
export async function pickAndUploadImage(
  path: string,
  options?: { aspect?: [number, number]; maxSizeMB?: number },
): Promise<string | null> {
  const maxBytes = (options?.maxSizeMB ?? 5) * 1024 * 1024;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: options?.aspect ?? [1, 1],
    quality: 0.8,
    base64: true,
  });

  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  if (!asset.base64) throw new Error('Failed to read image data');

  if (asset.fileSize && asset.fileSize > maxBytes) {
    throw new Error(`Image must be under ${options?.maxSizeMB ?? 5} MB`);
  }

  return uploadBase64Image(asset.base64, path);
}
