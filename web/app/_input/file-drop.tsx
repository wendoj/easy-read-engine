"use client";
import { FileUp } from "lucide-react";
import { useState } from "react";
import { cn } from "cn";

const ACCEPTED_FILES = "application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp";

/** A dashed drop area over a visually hidden file input. */
export function FileDrop({
  id,
  file,
  disabled,
  onFile,
}: {
  id: string;
  file: File | null;
  disabled: boolean;
  onFile: (file: File | null) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <label
      htmlFor={id}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) onFile(e.dataTransfer.files?.[0] ?? null);
      }}
      className={cn(
        "m-4 flex min-h-56 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-input bg-card px-6 py-8 text-center sm:m-6",
        "has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring",
        over && "border-primary bg-accent-tint",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <FileUp aria-hidden strokeWidth={2} absoluteStrokeWidth className="size-8 text-foreground" />
      <span className="text-xl font-semibold break-all">{file ? file.name : "Choose a photo or PDF of the letter"}</span>
      <span className="text-lg text-muted-foreground">{file ? "Choose a different file" : "Or drag it here"}</span>
      <input
        id={id}
        type="file"
        accept={ACCEPTED_FILES}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => onFile(event.target.files?.[0] ?? null)}
      />
    </label>
  );
}
