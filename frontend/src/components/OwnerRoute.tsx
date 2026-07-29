import { Navigate } from "react-router-dom";

import { useAuthStore } from "@/stores/auth";

export function OwnerRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);

  if (!user) {
    return null;
  }

  if (user.role !== "owner") {
    return <Navigate to="/registry" replace />;
  }

  return <>{children}</>;
}
