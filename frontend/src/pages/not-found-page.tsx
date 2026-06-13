import { Link } from "react-router-dom"

import { BrandLogo } from "@/components/brand-logo"
import { Button } from "@/components/ui/button"

export function NotFoundPage() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex items-center gap-2 font-semibold tracking-tight">
          <BrandLogo />
          NetraScope
        </div>
        <h1 className="text-4xl font-semibold tracking-tight">404</h1>
        <p className="max-w-sm text-muted-foreground">
          We couldn&apos;t find the page you&apos;re looking for.
        </p>
        <Button asChild>
          <Link to="/">Back to home</Link>
        </Button>
      </div>
    </div>
  )
}
