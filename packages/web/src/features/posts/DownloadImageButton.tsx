import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LoadingIcon } from "@/components/ui/loading-icon";

/**
 * A plain <a href download> ignores the download attribute for cross-origin
 * URLs (the card image is served from MinIO, a different origin than the
 * app) — browsers just navigate instead of saving. Fetching the image into a
 * same-origin blob URL first, then clicking a temporary link to that, is the
 * reliable cross-browser way to force a save. Whether that save happens
 * silently or a location prompt still appears is a per-browser "always ask
 * where to save" setting a page can't override — this is the best any page
 * can do, and it's silent by default in every mainstream browser.
 */
export function DownloadImageButton({ imageUrl, filename }: { imageUrl: string; filename: string }) {
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to download image");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      className="absolute right-2 top-2 h-8 w-8 [box-shadow:var(--shadow-m)]"
      aria-label={downloading ? "Downloading…" : "Download image"}
      disabled={downloading}
      onClick={handleDownload}
    >
      <LoadingIcon pending={downloading} icon="feather:download" />
    </Button>
  );
}
