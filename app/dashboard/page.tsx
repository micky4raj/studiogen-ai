import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { DashboardClient } from "./dashboard-client";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login"); // belt-and-suspenders; middleware.ts also enforces this

  return <DashboardClient userId={user.id} userEmail={user.email ?? ""} />;
}
