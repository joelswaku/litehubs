import type { Metadata } from "next";
import { Suspense } from "react";
import { AcceptInvitationScreen } from "./accept-invitation-screen";
export const metadata: Metadata = { title: "Activer votre accès" };
export default function AcceptInvitationPage() {
  return (
    <Suspense fallback={null}>
      <AcceptInvitationScreen />
    </Suspense>
  );
}
