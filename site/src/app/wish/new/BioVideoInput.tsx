"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { BIO_VIDEO_BUCKET, BIO_VIDEO_MAX_BYTES, BIO_VIDEO_MAX_SECONDS, BIO_VIDEO_TYPES } from "@/lib/bioVideo";

function videoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(v.duration); };
    v.onerror = () => { URL.revokeObjectURL(url); reject(new Error("unreadable")); };
    v.src = url;
  });
}

/** Optional bio video. Uploads straight to Supabase Storage, then hands the path to the form. */
export function BioVideoInput({ userId, onBusy }: { userId: string | null; onBusy: (busy: boolean) => void }) {
  const [path, setPath] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<{ busy?: boolean; error?: string }>({});

  async function pick(file: File | undefined) {
    if (!file) return;
    setStatus({});
    const ext = BIO_VIDEO_TYPES[file.type];
    if (!ext) return setStatus({ error: "Use an MP4, WebM or MOV video." });
    if (file.size > BIO_VIDEO_MAX_BYTES) return setStatus({ error: "That video is over 25 MB. Try a shorter or lower-quality clip." });
    let secs: number;
    try { secs = await videoDuration(file); } catch { return setStatus({ error: "Couldn't read that video." }); }
    if (!Number.isFinite(secs) || secs > BIO_VIDEO_MAX_SECONDS + 0.5) {
      return setStatus({ error: `Keep it to ${BIO_VIDEO_MAX_SECONDS} seconds or less.` });
    }
    if (!userId) return setStatus({ error: "Video upload is off in demo mode." });

    setStatus({ busy: true }); onBusy(true);
    const newPath = `${userId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabaseBrowser().storage.from(BIO_VIDEO_BUCKET)
      .upload(newPath, file, { contentType: file.type, cacheControl: "31536000", upsert: false });
    onBusy(false);
    if (error) return setStatus({ error: `Upload failed: ${error.message}` });
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    setPath(newPath);
    setStatus({});
  }

  function clear() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null); setPath(""); setStatus({});
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <label htmlFor="bio_video">
        Bio video <span className="hint">(optional, up to {BIO_VIDEO_MAX_SECONDS} seconds and 25 MB)</span>
      </label>
      <input type="hidden" name="bio_video_path" value={path} />
      {preview ? (
        <>
          <video src={preview} controls playsInline style={{ width: "100%", maxHeight: 320, borderRadius: 10, background: "#000" }} />
          <button type="button" className="btn small secondary" onClick={clear}>Remove video</button>
        </>
      ) : (
        <input id="bio_video" type="file" accept="video/mp4,video/webm,video/quicktime"
          disabled={status.busy} onChange={(e) => pick(e.target.files?.[0])} />
      )}
      {status.busy && <span className="hint">Uploading…</span>}
      {status.error && <div className="notice err">{status.error}</div>}
      <span className="hint">Say who you are and why this wish matters. Keep it kind: videos can be removed.</span>
    </div>
  );
}
