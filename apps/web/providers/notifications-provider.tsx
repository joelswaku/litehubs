"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { notificationsApi, type NotificationItem } from "@/services/notification.service";
import { useLanguage } from "@/providers/language-provider";

interface NotificationCenterValue {
  unreadCount: number;
  formattedUnreadCount: string;
  refresh: () => Promise<void>;
}

const NotificationCenterContext = createContext<NotificationCenterValue | null>(null);
const POLLING_INTERVAL_MS = 45_000;

function isViewingAction(pathname: string, orgSlug: string, actionUrl: string | null) {
  if (!actionUrl) return false;
  const scoped = `/${orgSlug}${actionUrl.startsWith("/") ? actionUrl : `/${actionUrl}`}`;
  return pathname === scoped || pathname.startsWith(`${scoped}/`);
}

export function NotificationProvider({
  orgSlug,
  children,
}: {
  orgSlug: string;
  children: React.ReactNode;
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const seenIds = useRef(new Set<string>());
  const initialized = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const count = useQuery({
    queryKey: ["notifications", orgSlug, "unread-count"],
    queryFn: () => notificationsApi.unreadCount(orgSlug),
    refetchInterval: POLLING_INTERVAL_MS,
  });
  const preview = useQuery({
    queryKey: ["notifications", orgSlug, "inbox-preview"],
    queryFn: () => notificationsApi.list(orgSlug, { tab: "unread", limit: 8 }),
    refetchInterval: POLLING_INTERVAL_MS,
  });

  const invalidate = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["notifications", orgSlug] }),
      queryClient.invalidateQueries({ queryKey: ["notification-preferences", orgSlug] }),
    ]);
  }, [orgSlug, queryClient]);

  const refresh = useCallback(async () => {
    await invalidate();
    channel.current?.postMessage({ type: "notifications:changed", orgSlug });
  }, [invalidate, orgSlug]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const nextChannel = new BroadcastChannel(`litehubs-notifications:${orgSlug}`);
    channel.current = nextChannel;
    nextChannel.onmessage = (event: MessageEvent<{ type?: string; orgSlug?: string }>) => {
      if (event.data?.type === "notifications:changed" && event.data.orgSlug === orgSlug)
        void invalidate();
    };
    return () => {
      nextChannel.close();
      channel.current = null;
    };
  }, [invalidate, orgSlug]);

  useEffect(() => {
    const notifications = preview.data?.notifications ?? [];
    if (!initialized.current) {
      notifications.forEach((notification) => seenIds.current.add(notification.id));
      initialized.current = true;
      return;
    }
    for (const notification of notifications) {
      if (seenIds.current.has(notification.id)) continue;
      seenIds.current.add(notification.id);
      if (isViewingAction(pathname, orgSlug, notification.actionUrl)) continue;
      toast(notification.title, {
        description: notification.message ?? undefined,
        action: notification.actionUrl
          ? {
              label: t("notifications.open"),
              onClick: () => router.push(`/${orgSlug}${notification.actionUrl}`),
            }
          : undefined,
        id: `notification:${notification.id}`,
      });
    }
  }, [orgSlug, pathname, preview.data?.notifications, router, t]);

  const unreadCount = count.data?.unreadCount ?? 0;
  const value = useMemo<NotificationCenterValue>(
    () => ({
      unreadCount,
      formattedUnreadCount: unreadCount > 99 ? "99+" : String(unreadCount),
      refresh,
    }),
    [refresh, unreadCount],
  );
  return (
    <NotificationCenterContext.Provider value={value}>
      {children}
    </NotificationCenterContext.Provider>
  );
}

export function useNotificationCenter() {
  const context = useContext(NotificationCenterContext);
  if (!context)
    throw new Error("useNotificationCenter must be used inside NotificationProvider");
  return context;
}

export function useOptionalNotificationCenter() {
  return useContext(NotificationCenterContext);
}

export function notificationActionPath(orgSlug: string, item: NotificationItem): string | null {
  return item.actionUrl ? `/${orgSlug}${item.actionUrl}` : null;
}
