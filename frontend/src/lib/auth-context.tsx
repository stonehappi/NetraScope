import { useCallback, useEffect, useState } from "react"
import type { ReactNode } from "react"

import { login as loginRequest, register as registerRequest } from "@/lib/api"
import {
  AUTH_UNAUTHORIZED_EVENT,
  clearSession,
  getStoredToken,
  getStoredUsername,
  storeSession,
} from "@/lib/auth"
import { AuthContext } from "@/lib/use-auth"

export function AuthProvider({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState<string | null>(() => getStoredUsername())
  const [token, setToken] = useState<string | null>(() => getStoredToken())

  const logout = useCallback(() => {
    clearSession()
    setToken(null)
    setUsername(null)
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const response = await loginRequest({ username, password })
    storeSession(response.token, response.username)
    setToken(response.token)
    setUsername(response.username)
  }, [])

  const register = useCallback(async (username: string, password: string) => {
    const response = await registerRequest({ username, password })
    storeSession(response.token, response.username)
    setToken(response.token)
    setUsername(response.username)
  }, [])

  useEffect(() => {
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, logout)
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, logout)
  }, [logout])

  return (
    <AuthContext.Provider
      value={{ username, isAuthenticated: token !== null, login, register, logout }}
    >
      {children}
    </AuthContext.Provider>
  )
}
