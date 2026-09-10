import { redirect } from "next/navigation";

/** Legacy URL kept for bookmarked staff links. */
export default function LegacyStaffLoginPage() {
  redirect("/staff");
}