"use client";

import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { ErrorState, SkeletonCard } from "@/components/ui/states";
import {
  PublicWebsiteRenderer,
} from "./public-website-renderer";
import {
  publicWebsiteRendererData,
  type PublicWebsiteResponse,
} from "./public-website-data";

export { publicWebsiteRendererData, type PublicWebsiteResponse } from "./public-website-data";

export function PublicWebsitePage({
  organizationSlug,
  pageSlug,
}: {
  organizationSlug: string;
  pageSlug?: string;
}) {
  const path = pageSlug
    ? `/public/organizations/${organizationSlug}/website/pages/${pageSlug}`
    : `/public/organizations/${organizationSlug}/website`;
  const query = useQuery({
    queryKey: ["public-website", organizationSlug, pageSlug ?? "home"],
    queryFn: () => get<PublicWebsiteResponse>(path),
    // A website owner commonly changes a page and immediately opens this
    // private preview in another tab.  Do not hold the old navigation for the
    // application's normal one-minute catalogue cache window.
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });

  if (query.isLoading) return <SkeletonCard rows={8} />;
  if (query.isError || !query.data) {
    return (
      <ErrorState
        title="This page is not available"
        description="It may still be a private draft, or the website has not been published yet."
        onRetry={() => void query.refetch()}
      />
    );
  }

  const rendered = publicWebsiteRendererData(query.data);
  return <PublicWebsiteRenderer website={rendered.website} page={rendered.page} />;
}
