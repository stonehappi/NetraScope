import { lazy, Suspense } from "react"
import { Route, Routes } from "react-router-dom"

import { RequireAuth } from "@/components/auth/require-auth"
import { AppLayout } from "@/components/layout/app-layout"
import { LandingPage } from "@/pages/landing-page"

// Route pages are loaded on demand so heavy dependencies (e.g. the charting
// library used only on the server-detail page) are split into separate chunks
// instead of bloating the initial bundle.
const LoginPage = lazy(() =>
  import("@/pages/login-page").then((m) => ({ default: m.LoginPage })),
)
const RegisterPage = lazy(() =>
  import("@/pages/register-page").then((m) => ({ default: m.RegisterPage })),
)
const DashboardPage = lazy(() =>
  import("@/pages/dashboard-page").then((m) => ({ default: m.DashboardPage })),
)
const ServerDetailPage = lazy(() =>
  import("@/pages/server-detail-page").then((m) => ({ default: m.ServerDetailPage })),
)
const SettingsPage = lazy(() =>
  import("@/pages/settings-page").then((m) => ({ default: m.SettingsPage })),
)
const NotFoundPage = lazy(() =>
  import("@/pages/not-found-page").then((m) => ({ default: m.NotFoundPage })),
)

function App() {
  return (
    <Suspense fallback={<div className="min-h-svh" aria-busy="true" />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="servers/:serverId" element={<ServerDetailPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  )
}

export default App
