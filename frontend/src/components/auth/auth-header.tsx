import { Link } from "react-router-dom"

import { BrandLogo } from "@/components/brand-logo"
import { ModeToggle } from "@/components/mode-toggle"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/use-auth"

export function AuthHeader() {
  const { isAuthenticated } = useAuth()

  return (
    <header className="sticky top-0 z-10 border-b bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <BrandLogo />
          NetraScope
        </Link>
        <div className="flex items-center gap-2">
          {isAuthenticated && (
            <Button asChild variant="ghost" size="sm">
              <Link to="/dashboard">Dashboard</Link>
            </Button>
          )}
          <ModeToggle />
        </div>
      </div>
    </header>
  )
}
