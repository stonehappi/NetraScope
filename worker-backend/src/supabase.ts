export class SupabaseError extends Error {
  constructor(
    public readonly status: number,
    public readonly details: string,
  ) {
    super(`Supabase request failed with status ${status}`)
  }
}

export async function supabaseRequest<T>(
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const authenticationHeaders: Record<string, string> = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  }
  if (env.SUPABASE_SERVICE_ROLE_KEY.startsWith("eyJ")) {
    authenticationHeaders.Authorization = `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
  }

  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...authenticationHeaders,
      "Content-Type": "application/json",
      ...init.headers,
    },
  })

  if (!response.ok) {
    throw new SupabaseError(response.status, await response.text())
  }

  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return undefined as T
  }

  return (await response.json()) as T
}

export function eq(value: string): string {
  return `eq.${encodeURIComponent(value)}`
}
