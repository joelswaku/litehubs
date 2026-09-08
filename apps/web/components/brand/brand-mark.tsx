import Image from "next/image";
import { cn } from "@/lib/utils";

/** The LiteHubs mark supplied in /public, reused instead of a text placeholder. */
export function BrandMark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Image
      src="/web-app-manifest-192x192.png"
      alt="LiteHubs"
      width={size}
      height={size}
      priority
      className={cn("shrink-0 rounded-md", className)}
    />
  );
}
