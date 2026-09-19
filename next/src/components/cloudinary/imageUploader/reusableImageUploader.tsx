"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { useDropzone, Accept } from "react-dropzone";
import { toast } from "sonner";
import { useAssetUpload } from "@/modules/assets/frontend/hooks/use-asset-upload";
import type { AssetDTO, AssetPurpose } from "@/modules/assets/frontend/types";
import { getCroppedImg } from "@/lib/media-upload/cropImage";

/* shadcn/ui components (assumed existing) */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
// NEW: lucide-react icons
import {
  FolderOpen,
  Images,
  Trash2,
  ArrowLeft,
  RotateCcw,
  RotateCw,
  Search,
} from "lucide-react";
import { getErrorMessage } from "@/utils/error";
import Image from "next/image";

/* ---------- Types ---------- */
export interface GalleryImage {
  uid: string;
  name: string;
  url: string;
  tags: string[];
}

export interface ReusableImageUploaderProps {
  /** Which upload purpose this image is for — resolves the server-side policy. */
  purpose: AssetPurpose;
  targetEntityType?: string;
  targetEntityId?: string;
  gallery?: GalleryImage[];
  onUpload?: (
    url: string,
    asset?: AssetDTO,
  ) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  title?: string;
  initialImage?: string;
  accept?: Accept | string;
  customCropShape?: "round" | "rect";
  aspectRatio?: number;
  children?: React.ReactNode;
  setOpen?: (open: boolean) => void;
}

/* ---------- Helper Components ---------- */
interface HeaderBackProps {
  onBack(): void;
  label?: string;
}
function BackHeader({ onBack, label = "Back" }: HeaderBackProps) {
  return (
    <Button
      variant="ghost"
      onClick={onBack}
      className="w-fit flex items-center gap-2 text-primary"
    >
      <ArrowLeft className="h-4 w-4" /> {label}
    </Button>
  );
}

interface OptionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  children: React.ReactNode;
}
function OptionButton({
  icon,
  children,
  className = "",
  ...rest
}: OptionButtonProps) {
  return (
    <Button
      variant="outline"
      className={`justify-start gap-3 w-full border-2 border-primary text-primary font-semibold hover:bg-primary hover:text-white transition-colors rounded-xl py-6 text-base ${className}`}
      {...rest}
    >
      {icon}
      <span className="flex-1 text-left">{children}</span>
    </Button>
  );
}

interface MainOptionsViewProps {
  onSelect(view: ViewState): void;
  showDelete: boolean;
  children?: React.ReactNode;
}
function MainOptionsView({ onSelect, showDelete, children }: MainOptionsViewProps) {
  return (
    <div className="flex flex-col gap-3 w-full">
      <OptionButton
        icon={<FolderOpen className="h-5 w-5" />}
        onClick={() => onSelect("upload")}
      >
        Upload from Device
      </OptionButton>
      {
        <OptionButton
          icon={<Images className="h-5 w-5" />}
          onClick={() => onSelect("gallery")}
        >
          Choose from Gallery
        </OptionButton>
      }
      {showDelete && (
        <OptionButton
          icon={<Trash2 className="h-5 w-5" />}
          onClick={() => onSelect("delete")}
        >
          Delete Image
        </OptionButton>
      )}
      {children}
    </div>
  );
}

interface GalleryViewProps {
  images: GalleryImage[];
  search: string;
  setSearch(v: string): void;
  selectedId: string | null;
  onSelect(img: GalleryImage): void;
}
function GalleryView({
  images,
  search,
  setSearch,
  selectedId,
  onSelect,
}: GalleryViewProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search images..."
          className="flex-1"
        />
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,110px)] max-[460px]:grid-cols-[repeat(auto-fit,80px)] justify-center gap-4 max-h-[350px] overflow-y-auto pb-2">
        {images.map((img) => {
          const selected = img.uid === selectedId;
          return (
            <button
              key={img.uid}
              title={img.name}
              onClick={() => onSelect(img)}
              className={`group relative flex flex-col rounded-xl overflow-hidden border-2 bg-muted/40 hover:shadow transition ${
                selected ? "border-primary shadow-sm" : "border-transparent"
              }`}
            >
              <img
                src={img.url}
                alt={img.name}
                loading="lazy"
                className="object-contain w-full h-full aspect-square bg-background"
              />
              <div className="text-[11px] px-1 py-1 w-full text-center truncate bg-white/80 backdrop-blur-sm text-foreground">
                {img.name}
              </div>
            </button>
          );
        })}
        {images.length === 0 && (
          <div className="col-span-full text-center text-sm text-muted-foreground py-6">
            No images found.
          </div>
        )}
      </div>
    </div>
  );
}

interface DeleteViewProps {
  onDelete(): void | Promise<void>;
}
function DeleteView({ onDelete }: DeleteViewProps) {
  return (
    <div className="flex flex-col gap-6 items-center">
      <p className="text-sm text-muted-foreground">
        Are you sure you want to delete the image?
      </p>
      <Button
        variant="destructive"
        onClick={onDelete}
        className="flex items-center gap-2 font-semibold"
      >
        <Trash2 className="h-4 w-4" /> Delete
      </Button>
    </div>
  );
}

interface CropperSectionProps {
  imageSrc: string;
  zoom: number;
  rotation: number;
  crop: { x: number; y: number };
  shape: "round" | "rect";
  aspectRatio: number;
  uploading: boolean;
  progress: number;
  onCropChange(c: { x: number; y: number }): void;
  onZoomChange(v: number): void;
  onRotationChange(v: number): void;
  onConfirm(): void;
  onCancel(): void;
  onCropComplete(area: Area, pixels: Area): void;
}
function CropperSection({
  imageSrc,
  crop,
  zoom,
  rotation,
  shape,
  aspectRatio,
  uploading,
  progress,
  onCropChange,
  onZoomChange,
  onRotationChange,
  onConfirm,
  onCancel,
  onCropComplete,
}: CropperSectionProps) {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative w-full h-[300px] rounded-xl overflow-hidden bg-neutral-900 shadow-inner">
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          rotation={rotation}
          aspect={aspectRatio}
          onCropChange={onCropChange}
          onZoomChange={(z) => onZoomChange(z)}
          onRotationChange={(r) => onRotationChange(r)}
          onCropComplete={onCropComplete}
          cropShape={shape}
          showGrid={false}
        />
      </div>
      <div className="flex flex-wrap items-center justify-center gap-4 w-full">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-muted-foreground">
            Zoom
          </span>
          <div className="w-40">
            <Slider
              value={[zoom]}
              min={1}
              max={3}
              step={0.01}
              onValueChange={(v) => onZoomChange(v[0])}
            />
          </div>
        </div>
        <Button
          size="icon"
          variant="outline"
          onClick={() => onRotationChange(rotation - 90)}
          title="Rotate Left"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          onClick={() => onRotationChange(rotation + 90)}
          title="Rotate Right"
        >
          <RotateCw className="h-4 w-4" />
        </Button>
      </div>
      {uploading && (
        <div className="w-full space-y-1">
          <Progress value={progress} />
          <p className="text-xs text-muted-foreground text-center">
            {progress}%
          </p>
        </div>
      )}
      <div className="flex gap-3">
        <Button
          onClick={onConfirm}
          disabled={uploading}
          className="font-semibold"
        >
          {uploading ? `Uploading ${progress}%` : "Crop & Upload"}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={uploading}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

type ViewState = "main" | "upload" | "gallery" | "delete";

/* ---------- Main Component ---------- */
function ReusableImageUploader({
  purpose,
  targetEntityType,
  targetEntityId,
  gallery = [],
  onUpload,
  onDelete,
  title = "Upload Image",
  initialImage = "",
  accept = "image/*",
  customCropShape = "rect",
  aspectRatio = 1,
  children,
  setOpen,
}: ReusableImageUploaderProps) {
  const [view, setView] = useState<ViewState>("main");
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [crop, setCrop] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [search, setSearch] = useState("");
  const [selectedGalleryImage, setSelectedGalleryImage] = useState<
    string | null
  >(null);
  const [showCropper, setShowCropper] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);

  const { upload, uploading, progress } = useAssetUpload({
    purpose,
    targetEntityType,
    targetEntityId,
  });

  const filteredGallery = useMemo(
    () =>
      gallery.filter(
        (img) =>
          img.name.toLowerCase().includes(search.toLowerCase()) ||
          img.tags.some((t) => t.toLowerCase().includes(search.toLowerCase())),
      ),
    [gallery, search],
  );

  /* ----- Dropzone ----- */
  const onDrop = useCallback((accepted: File[]) => {
    if (!accepted.length) return;
    const file = accepted[0];
    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(reader.result as string);
      setShowCropper(true);
      setZoom(1);
      setRotation(0);
      setCrop({ x: 0, y: 0 });
    };
    reader.readAsDataURL(file);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    accept: typeof accept === "string" ? undefined : (accept as Accept),
  });

  /* ----- Crop Complete ----- */
  const handleCropComplete = useCallback(
    (_: Area, pixels: Area) => setCroppedAreaPixels(pixels),
    [],
  );

  /* ----- Confirm Crop & Upload ----- */
  const handleCropConfirm = useCallback(async () => {
    if (!imageSrc || !croppedAreaPixels) return;
    try {
      toast.loading("Uploading image...", { id: "image-upload" });
      const blob: Blob = await getCroppedImg(
        imageSrc,
        croppedAreaPixels,
        rotation,
      );
      const asset = await upload(blob);
      if (onUpload) await onUpload(asset.secureUrl, asset);
      toast.success("Image uploaded!", { id: "image-upload" });
      setShowCropper(false);
      setImageSrc(null);
      setView("main");
      setOpen?.(false);
    } catch (e: unknown) {
      toast.error(getErrorMessage(e), { id: "image-upload" });
    }
  }, [imageSrc, croppedAreaPixels, rotation, upload, onUpload, setOpen]);

  const handleCancelCrop = () => {
    setShowCropper(false);
    setImageSrc(null);
  };

  /* ----- Gallery Select ----- */
  const handleGallerySelect = async (img: GalleryImage) => {
    setSelectedGalleryImage(img.uid);
    if (onUpload) await onUpload(img.url);
    toast.success("Image updated from gallery!");
    setView("main");
    setOpen?.(false);
  };

  /* ----- Delete ----- */
  const handleDelete = async () => {
    if (!onDelete) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          "ReusableImageUploader: handleDelete invoked with no onDelete handler.",
        );
      }
      toast.error("Delete is not available.");
      return;
    }

    try {
      await onDelete();
      toast.success("Image removed!");
      setView("main");
      setOpen?.(false);
    } catch (e: unknown) {
      toast.error(getErrorMessage(e));
    }
  };

  const onBack = () => setView("main");

  /* ----- Render Views ----- */
  return (
    <div className="flex flex-col gap-3 w-full">
      {title && (
        <div className="text-lg font-semibold tracking-tight flex items-center gap-2">
          {initialImage && view === "main" && (
            <span className=" relative inline-block h-12 w-12 rounded-full overflow-hidden ring-2 ring-primary/30">
              <Image
                src={initialImage}
                alt="Current image"
                fill
                sizes="48px"
                className="object-cover"
              />
            </span>
          )}
          <h1 className="mr-auto">{title}</h1>
        </div>
      )}

      {/* <BackHeader onBack={onBack} /> */}

      {view === "main" && (
        <MainOptionsView onSelect={setView} showDelete={Boolean(onDelete)}>
          {children}
        </MainOptionsView>
      )}

      {view === "upload" && (
        <>
          <BackHeader onBack={onBack} />
          <div className="flex flex-col gap-4">
            {showCropper && imageSrc ? (
              <CropperSection
                imageSrc={imageSrc}
                crop={crop}
                zoom={zoom}
                rotation={rotation}
                shape={customCropShape}
                aspectRatio={aspectRatio}
                uploading={uploading}
                progress={progress}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onRotationChange={setRotation}
                onConfirm={handleCropConfirm}
                onCancel={handleCancelCrop}
                onCropComplete={handleCropComplete}
              />
            ) : (
              <div className="flex flex-col items-center gap-6">
                <div
                  {...getRootProps()}
                  className={`w-full rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition
                  bg-muted/40 hover:bg-muted/60 border-primary/60
                  ${isDragActive ? "ring-2 ring-primary" : ""}`}
                >
                  <input
                    {...getInputProps()}
                    ref={inputRef}
                    accept={typeof accept === "string" ? accept : undefined}
                  />
                  {isDragActive ? (
                    <p className="text-sm font-medium text-primary">
                      Drop the image here...
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Drag & drop an image here, or{" "}
                      <button
                        type="button"
                        onClick={() => inputRef.current?.click()}
                        className="underline text-primary font-semibold"
                      >
                        Browse
                      </button>
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {view === "gallery" && (
        <>
          {" "}
          <BackHeader onBack={onBack} />
          <GalleryView
            images={filteredGallery}
            search={search}
            setSearch={setSearch}
            selectedId={selectedGalleryImage}
            onSelect={handleGallerySelect}
          />
        </>
      )}

      {view === "delete" && (
        <>
          <BackHeader onBack={onBack} />
          <DeleteView onDelete={handleDelete} />
        </>
      )}
    </div>
  );
}

export default ReusableImageUploader;
