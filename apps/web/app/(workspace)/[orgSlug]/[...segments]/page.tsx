import { WorkspaceAreaView } from "./workspace-area-view";

export default async function WorkspaceAreaPage({
  params,
}: {
  params: Promise<{ orgSlug: string; segments: string[] }>;
}) {
  const { orgSlug, segments } = await params;
  return (
    <WorkspaceAreaView orgSlug={orgSlug} path={`/${segments.join("/")}`} />
  );
}
