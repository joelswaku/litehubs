import { redirect } from "next/navigation";

/** Legacy company-creation link kept for existing invitations and bookmarks. */
export default function LegacyStaffCompanyRegistrationPage() {
  redirect("/staff/register");
}