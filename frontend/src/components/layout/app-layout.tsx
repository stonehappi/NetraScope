import { Link, Outlet } from "react-router-dom"
import { LogOut, Settings } from "lucide-react"

import { BrandLogo } from "@/components/brand-logo"
import { ModeToggle } from "@/components/mode-toggle"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/use-auth"

export function AppLayout() {
  const { username, logout } = useAuth()

  return (
    <div className="relative min-h-svh overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-32 size-96 rounded-full bg-chart-1/25 blur-3xl" />
        <div className="absolute top-1/4 -right-32 size-96 rounded-full bg-chart-4/20 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 size-112 rounded-full bg-chart-2/15 blur-3xl" />
      </div>
      <header className="sticky top-0 z-10 border-b bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link to="/dashboard" className="flex items-center gap-2 font-semibold tracking-tight">
            <BrandLogo />
            NetraScope
          </Link>
          <div className="flex items-center gap-2">
            {username && (
              <span className="hidden text-sm text-muted-foreground sm:inline">{username}</span>
            )}
            <Button variant="ghost" size="icon" asChild aria-label="Settings">
              <Link to="/settings">
                <Settings className="size-4" />
              </Link>
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Sign out">
                  <LogOut className="size-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Sign out?</AlertDialogTitle>
                  <AlertDialogDescription>
                    You'll need to sign in again to access your dashboard.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={logout}>Sign out</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <ModeToggle />
          </div>
        </div>
      </header>
      <main className="relative mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
