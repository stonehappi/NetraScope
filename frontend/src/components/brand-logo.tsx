import { cn } from "@/lib/utils"

export function BrandLogo({ className }: { className?: string }) {
  return <img src="/logo.png" alt="NetraScope" className={cn("size-6 rounded-md", className)} />
}
