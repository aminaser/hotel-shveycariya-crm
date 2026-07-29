import { useQuery } from "@tanstack/react-query";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";

import { apiFetch } from "@/api/client";
import { AutoBackupOnExit } from "@/components/AutoBackupOnExit";
import { OwnerRoute } from "@/components/OwnerRoute";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ActsPage } from "@/pages/ActsPage";
import { ActivityPage } from "@/pages/ActivityPage";
import { AnalyticsPage } from "@/pages/AnalyticsPage";
import { BanquetsPage } from "@/pages/BanquetsPage";
import { CalendarPage } from "@/pages/CalendarPage";
import { ClientsPage } from "@/pages/ClientsPage";
import { LoginPage } from "@/pages/LoginPage";
import { RegistryPage } from "@/pages/RegistryPage";
import { RequestsPage } from "@/pages/RequestsPage";
import { RoomsPage } from "@/pages/RoomsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { SetupPage } from "@/pages/SetupPage";
import { SpaJournalPage } from "@/pages/SpaJournalPage";
import { TimesheetPage } from "@/pages/TimesheetPage";
import { TrashPage } from "@/pages/TrashPage";

function RootRedirect() {
  const { data, isLoading } = useQuery({
    queryKey: ["setup-status"],
    queryFn: () => apiFetch<{ is_initialized: boolean }>("/setup/status"),
  });

  if (isLoading) return null;
  if (!data?.is_initialized) return <Navigate to="/setup" replace />;
  return <Navigate to="/registry" replace />;
}

export default function App() {
  const { data: setupStatus, isLoading } = useQuery({
    queryKey: ["setup-status"],
    queryFn: () => apiFetch<{ is_initialized: boolean }>("/setup/status"),
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Загрузка...
      </div>
    );
  }

  return (
    <HashRouter>
      <AutoBackupOnExit />
      <Routes>
        <Route
          path="/setup"
          element={
            setupStatus?.is_initialized ? (
              <Navigate to="/login" replace />
            ) : (
              <SetupPage />
            )
          }
        />
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/registry" element={<RegistryPage />} />
          <Route path="/requests" element={<RequestsPage />} />
          <Route path="/spa" element={<SpaJournalPage />} />
          <Route path="/spa-journal" element={<Navigate to="/spa" replace />} />
          <Route path="/banquets" element={<BanquetsPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route
            path="/analytics"
            element={
              <OwnerRoute>
                <AnalyticsPage />
              </OwnerRoute>
            }
          />
          <Route path="/acts" element={<ActsPage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/timesheet" element={<TimesheetPage />} />
          <Route path="/rooms" element={<RoomsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/trash" element={<TrashPage />} />
        </Route>
        <Route path="/" element={<RootRedirect />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster position="top-right" richColors />
    </HashRouter>
  );
}
