import { AdminShell } from "@/components/admin-shell";
import { headers } from "next/headers";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  return <AdminShell privateEntry={requestHeaders.get("x-maqar-private-entry") === "1"}>{children}</AdminShell>;
}
