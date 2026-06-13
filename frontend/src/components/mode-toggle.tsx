import { Moon, Sun, MonitorCog } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function ModeToggle() {
  const { setTheme, theme } = useTheme()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Toggle theme">
          <Sun className="size-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
          <Moon className="absolute size-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")} className="gap-2">
          <Sun className="size-4" />
          Light
          {theme === "light" && <span className="ml-auto text-xs text-muted-foreground">Active</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")} className="gap-2">
          <Moon className="size-4" />
          Dark
          {theme === "dark" && <span className="ml-auto text-xs text-muted-foreground">Active</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")} className="gap-2">
          <MonitorCog className="size-4" />
          System
          {theme === "system" && <span className="ml-auto text-xs text-muted-foreground">Active</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
