const TOKEN_STORAGE_KEY = "netrascope.token"
const USERNAME_STORAGE_KEY = "netrascope.username"

export const AUTH_UNAUTHORIZED_EVENT = "netrascope:unauthorized"

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY)
}

export function getStoredUsername(): string | null {
  return localStorage.getItem(USERNAME_STORAGE_KEY)
}

export function storeSession(token: string, username: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token)
  localStorage.setItem(USERNAME_STORAGE_KEY, username)
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY)
  localStorage.removeItem(USERNAME_STORAGE_KEY)
}

export function notifyUnauthorized(): void {
  window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT))
}
