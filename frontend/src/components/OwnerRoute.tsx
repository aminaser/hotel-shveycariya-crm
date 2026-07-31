import { Navigate } from "react-router-dom";

import { canViewAnalytics, useAuthStore } from "@/stores/auth";

/** Analytics and menu settings are only for Жибек (username zhibek). */
export function OwnerRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);

  if (!user) {
    return null;
  }

  if (!canViewAnalytics(user)) {
    return <Navigate to="/registry" replace />;
  }

  return <>{children}</>;
}
