import { supabaseUrl } from "./config";

export const BIO_VIDEO_BUCKET = "bio-videos";
/** Keep in sync with 0007_bio_video.sql (bucket file_size_limit). */
export const BIO_VIDEO_MAX_BYTES = 25 * 1024 * 1024;
export const BIO_VIDEO_MAX_SECONDS = 60;
export const BIO_VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};
const PATH_RE = /^[0-9a-f-]{36}\/[A-Za-z0-9_-]+\.(mp4|webm|mov)$/;

export function isValidBioVideoPath(path: string, userId: string) {
  return PATH_RE.test(path) && path.split("/")[0] === userId;
}

export function bioVideoUrl(path: string) {
  return `${supabaseUrl}/storage/v1/object/public/${BIO_VIDEO_BUCKET}/${path}`;
}
