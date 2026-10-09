"use client";

import { ImagePlus, X } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { TextArea } from "@/components/ui/field";
import type { DesignSpec } from "@/domain/design/spec";

export type DesignImage = DesignSpec["images"][number];

const maxSide = 800;

function shrink(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      const canvas = Object.assign(document.createElement("canvas"), {
        width: Math.round(image.width * scale),
        height: Math.round(image.height * scale),
      });
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(image.src);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
    image.onerror = reject;
    image.src = URL.createObjectURL(file);
  });
}

export function Images({ images, onChange }: { images: DesignImage[]; onChange: (images: DesignImage[]) => void }) {
  const add = async (files: File[]) => {
    const sources = await Promise.all(files.map(shrink));
    onChange([...images, ...sources.map((src) => ({ src, note: "" }))]);
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted">
        Sketches and images
        <span className="ml-1.5 font-normal text-faint">an interface sketch, a mock-up, or example content, with a note on what it shows</span>
      </span>
      {images.map((image, index) => (
        <div key={index} className="grid grid-cols-[10rem_1fr_auto] items-start gap-3">
          <div
            role="img"
            aria-label={image.note || `Image ${index + 1}`}
            style={{ backgroundImage: `url(${image.src})` }}
            className="h-28 rounded border border-line bg-white bg-contain bg-center bg-no-repeat"
          />
          <TextArea
            value={image.note}
            onChange={(event) => onChange(images.map((item, position) => (position === index ? { ...item, note: event.target.value } : item)))}
            rows={3}
            placeholder="The main view: the draft on the left, the model's critiques in the margin"
          />
          <button
            type="button"
            onClick={() => onChange(images.filter((_, position) => position !== index))}
            aria-label={`Remove image ${index + 1}`}
            className="rounded p-1 text-faint hover:text-ink"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <label className={buttonClass("ghost", "-ml-3 w-fit cursor-pointer")}>
        <ImagePlus className="size-3.5" />
        Add image
        <input
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            add(files);
          }}
        />
      </label>
    </div>
  );
}
