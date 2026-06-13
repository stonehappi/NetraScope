import { Route, Routes } from "react-router-dom"

import { RequireAuth } from "@/components/auth/require-auth"
import { AppLayout } from "@/components/layout/app-layout"
import { DashboardPage } from "@/pages/dashboard-page"
import { LandingPage } from "@/pages/landing-page"
import { LoginPage } from "@/pages/login-page"
import { NotFoundPage } from "@/pages/not-found-page"
import { RegisterPage } from "@/pages/register-page"
import { ServerDetailPage } from "@/pages/server-detail-page"
import { SettingsPage } from "@/pages/settings-page"

function App() {
  return (
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
  )
}

export default App
