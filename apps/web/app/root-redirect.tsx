"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useSession } from "@/hooks/useAuth";
import { landingPathFor } from "@/lib/auth";
import { setActiveOrganizationSlug } from "@/lib/api";
import { useLanguage } from "@/providers/language-provider";
export function RootRedirect() {
  const { t } = useLanguage();
  const router = useRouter();
  const { data: user, isError, isPending } = useSession();
  useEffect(() => {
    if (isError) {
      router.replace("/login");
      return;
    }
    if (!user) return;
    if (user.activeOrganization)
      setActiveOrganizationSlug(user.activeOrganization.slug);
    router.replace(landingPathFor(user));
  }, [user, isError, router]);
  return (
    <div className="grid min-h-dvh place-items-center">
      <div
        className="flex items-center gap-2 text-sm text-ink-secondary"
        role="status"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {isPending ? t("workspace.loading") : localeLabel(t)}
      </div>
    </div>
  );
}
function localeLabel(t: (key: "workspace.loading") => string) {
  return t("workspace.loading");
}
