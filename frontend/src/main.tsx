import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { ThemeProvider } from '@/components/theme-provider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { AuthProvider } from '@/lib/auth-context'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: 15_000,
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
            <Toaster />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
