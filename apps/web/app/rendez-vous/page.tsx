import { permanentRedirect } from "next/navigation";

/** French public URL retained for printed materials and QR posters. */
export default function RendezVousAlias() {
  permanentRedirect("/rendezvous");
}