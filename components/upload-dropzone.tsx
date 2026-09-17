"use client";

import { useCallback, useState } from "react";
import { getSupabaseBrowserClient, STORAGE_BUCKET } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export function UploadDropzone({
  userId,
  onUploaded,
}: {
  userId: string;
  onUploaded: (url: string) => void;
}) {
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

  const uploadFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        setError("Please upload an image file.");
        return;
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        setError("Image is too large — please use a file under 10MB.");
        return;
      }

      setUploading(true);
      setError(null);
      setPreviewUrl(URL.createObjectURL(file));

      try {
        const supabase = getSupabaseBrowserClient();
        const path = `${userId}/raw/${Date.now()}-${file.name}`;

        const { error: uploadError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(path, file, { upsert: true });

        if (uploadError) throw uploadError;

        const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
        onUploaded(data.publicUrl);
      } catch (err) {
        console.error(err);
        setError("Upload failed. Try a different file.");
        setPreviewUrl(null);
      } finally {
        setUploading(false);
      }
    },
    [userId, onUploaded]
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragActive(false);
        const file = e.dataTransfer.files?.[0];
        if (file) uploadFile(file);
      }}
      className={cn(
        "relative flex aspect-square w-full flex-col items-center justify-center rounded-sm border border-dashed border-border text-center transition-colors",
        dragActive && "border-accent bg-accent/5"
      )}
    >
      {previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewUrl} alt="Raw upload preview" className="h-full w-full rounded-sm object-cover" />
      ) : (
        <>
          <p className="text-sm text-muted">Drag a product photo here, or</p>
          <label className="mt-2 cursor-pointer text-sm font-medium text-accent-foreground underline decoration-accent decoration-2 underline-offset-4">
            browse files
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadFile(file);
              }}
            />
          </label>
        </>
      )}

      {uploading && (
        <div className="absolute inset-0 flex items-center justify-center rounded-sm bg-background/70 text-sm">
          Uploading…
        </div>
      )}

      {error && <p className="absolute -bottom-6 text-xs text-red-600">{error}</p>}
    </div>
  );
}
