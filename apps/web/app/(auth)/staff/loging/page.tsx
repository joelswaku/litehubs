import { redirect } from "next/navigation";

export default function StaffLogingRedirectPage() {
  redirect("/staff/login");
}