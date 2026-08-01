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
import { BookingsPage } from "@/pages/BookingsPage";
import { CalendarPage } from "@/pages/CalendarPage";
import { ClientsPage } from "@/pages/ClientsPage";
import { LoginPage } from "@/pages/LoginPage";
import { MenuSettingsPage } from "@/pages/MenuSettingsPage";
import { RegistryPage } from "@/pages/RegistryPage";
import { RequestsPage } from "@/pages/RequestsPage";
import { RoomsPage } from "@/pages/RoomsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { SetupPage } from "@/pages/SetupPage";
import { SpaJournalPage } from "@/pages/SpaJournalPage";
import { TakeawayOrdersPage } from "@/pages/TakeawayOrdersPage";
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
  const { data: setupStatus, isLoading, isError, refetch } = useQuery({
    queryKey: ["setup-status"],
    queryFn: () => apiFetch<{ is_initialized: boolean }>("/setup/status"),
    retry: 2,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Загрузка...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-muted-foreground">
          Не удалось связаться с сервером CRM. Подождите пару секунд и попробуйте снова.
        </p>
        <button
          type="button"
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          onClick={() => void refetch()}
        >
          Повторить
        </button>
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
          <Route path="/bookings" element={<BookingsPage />} />
          <Route path="/requests" element={<RequestsPage />} />
          <Route path="/spa" element={<SpaJournalPage />} />
          <Route path="/spa-journal" element={<Navigate to="/spa" replace />} />
          <Route path="/banquets" element={<BanquetsPage />} />
          <Route path="/takeaway" element={<TakeawayOrdersPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route
            path="/analytics"
            element={
              <OwnerRoute>
                <AnalyticsPage />
              </OwnerRoute>
            }
          />
          <Route
            path="/menu-settings"
            element={
              <OwnerRoute>
                <MenuSettingsPage />
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
      <Toaster
        position="top-right"
        richColors
        duration={2000}
        closeButton
        toastOptions={{ duration: 2000 }}
      />
    </HashRouter>
  );
}
