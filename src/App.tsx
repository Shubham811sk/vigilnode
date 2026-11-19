import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/Layout';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { TelemetryProvider } from './contexts/TelemetryContext';
import { ToastProvider } from './contexts/ToastContext';
import AddMonitorPage from './pages/AddMonitorPage';
import AlertsIntegrationsPage from './pages/AlertsIntegrationsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import DashboardPage from './pages/DashboardPage';
import IncidentsPage from './pages/IncidentsPage';
import LoginPage from './pages/LoginPage';
import MaintenancePage from './pages/MaintenancePage';
import MonitorDetailsPage from './pages/MonitorDetailsPage';
import MonitorsPage from './pages/MonitorsPage';
import PublicStatusPage from './pages/PublicStatusPage';
import SettingsPage from './pages/SettingsPage';
import UserManagementPage from './pages/UserManagementPage';

function ProtectedShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#031427] text-[#adc6ff] flex items-center justify-center font-mono text-xs">
        Verifying VigilNode telemetry session...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <AppLayout>{children}</AppLayout>;
}

function PublicOnlyLogin() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return <LoginPage />;
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <TelemetryProvider>
          <BrowserRouter>
            <Routes>
              {/* Public Unauthenticated Routes */}
              <Route path="/login" element={<PublicOnlyLogin />} />
              <Route path="/status" element={<PublicStatusPage />} />

              {/* Authenticated Operator Routes (All 10 Admin/Maintainer Pages) */}
              <Route
                path="/"
                element={
                  <ProtectedShell>
                    <DashboardPage />
                  </ProtectedShell>
                }
              />
              <Route
                path="/monitors"
                element={
                  <ProtectedShell>
                    <MonitorsPage />
                  </ProtectedShell>
                }
              />
              <Route
                path="/monitors/new"
                element={
                  <ProtectedShell>
                    <AddMonitorPage />
                  </ProtectedShell>
                }
              />
              <Route
                path="/monitors/:id/edit"
                element={
                  <ProtectedShell>
                    <AddMonitorPage />
                  </ProtectedShell>
                }
              />
              <Route
                path="/monitors/:id"
                element={
                  <ProtectedShell>
                    <MonitorDetailsPage />
                  </ProtectedShell>
                }
              />
              <Route
                path="/monitor-details"
                element={
                  <ProtectedShell>
                    <MonitorDetailsPage />
                  </ProtectedShell>
                }
              />
              <Route
                path="/incidents"
                element={
                  <ProtectedShell>
                    <IncidentsPage />
                  </ProtectedShell>
                }
              />
              <Route
                path="/maintenance"
                element={
                  <ProtectedShell>
                    <MaintenancePage />
                  </ProtectedShell>
                }
              />
              <Route
                path="/alerts"
                element={
                  <ProtectedShell>
                    <AlertsIntegrationsPage />
                  </ProtectedShell>
                }
              />
              <Route
                path="/analytics"
                element={
                  <ProtectedShell>
                    <AnalyticsPage />
                  </ProtectedShell>
                }
              />
              <Route
                path="/settings"
                element={
                  <ProtectedShell>
                    <SettingsPage />
                  </ProtectedShell>
                }
              />
              <Route
                path="/users"
                element={
                  <ProtectedShell>
                    <UserManagementPage />
                  </ProtectedShell>
                }
              />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </TelemetryProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
