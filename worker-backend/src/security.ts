const encoder = new TextEncoder()
const passwordIterations = 100_000
const passwordPrefix = "netrascope-pbkdf2-v1"

interface TokenPayload {
  sub: string
  unique_name: string
  iss: string
  aud: string
  iat: number
  exp: number
}

export interface AuthenticatedUser {
  id: string
  username: string
}

function toBase64(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function toBase64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? encoder.encode(value) : value
  return toBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/")
  return fromBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  )
}

async function derivePassword(
  password: string,
  salt: Uint8Array,
  iterations: number,
  hash: "SHA-1" | "SHA-256" | "SHA-512",
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash },
    key,
    length * 8,
  )
  return new Uint8Array(bits)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derivePassword(password, salt, passwordIterations, "SHA-256", 32)
  return `${passwordPrefix}$${passwordIterations}$${toBase64(salt)}$${toBase64(hash)}`
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (storedHash.startsWith(`${passwordPrefix}$`)) {
    const [, iterationsValue, saltValue, hashValue] = storedHash.split("$")
    const expected = fromBase64(hashValue)
    const actual = await derivePassword(
      password,
      fromBase64(saltValue),
      Number(iterationsValue),
      "SHA-256",
      expected.length,
    )
    return timingSafeEqual(actual, expected)
  }

  return verifyAspNetIdentityPassword(password, storedHash)
}

async function verifyAspNetIdentityPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  let decoded: Uint8Array
  try {
    decoded = fromBase64(storedHash)
  } catch {
    return false
  }

  if (decoded.length < 14 || decoded[0] !== 1) {
    return false
  }

  const view = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength)
  const prf = view.getUint32(1, false)
  const iterations = view.getUint32(5, false)
  const saltLength = view.getUint32(9, false)
  const hashName = prf === 0 ? "SHA-1" : prf === 1 ? "SHA-256" : prf === 2 ? "SHA-512" : null
  if (!hashName || saltLength < 16 || decoded.length <= 13 + saltLength) {
    return false
  }

  const salt = decoded.slice(13, 13 + saltLength)
  const expected = decoded.slice(13 + saltLength)
  const actual = await derivePassword(password, salt, iterations, hashName, expected.length)
  return timingSafeEqual(actual, expected)
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false
  }

  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index]
  }
  return difference === 0
}

export function generateIngestionToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")
}

export async function hashIngestionToken(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(token))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export function tokenSuffix(token: string): string {
  return token.length <= 8 ? token : token.slice(-8)
}

export async function createJwt(
  env: Env,
  user: AuthenticatedUser,
): Promise<{ token: string; expiresAt: string }> {
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + Number(env.JWT_EXPIRY_MINUTES) * 60
  const header = toBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const payload = toBase64Url(
    JSON.stringify({
      sub: user.id,
      unique_name: user.username,
      iss: env.JWT_ISSUER,
      aud: env.JWT_AUDIENCE,
      iat: now,
      exp: expiresAt,
    } satisfies TokenPayload),
  )
  const signingInput = `${header}.${payload}`
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", await importHmacKey(env.JWT_SECRET), encoder.encode(signingInput)),
  )

  return {
    token: `${signingInput}.${toBase64Url(signature)}`,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  }
}

export async function verifyJwt(env: Env, token: string): Promise<AuthenticatedUser | null> {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) {
      return null
    }

    const [headerValue, payloadValue, signatureValue] = parts
    const validSignature = await crypto.subtle.verify(
      "HMAC",
      await importHmacKey(env.JWT_SECRET),
      fromBase64Url(signatureValue) as BufferSource,
      encoder.encode(`${headerValue}.${payloadValue}`),
    )
    if (!validSignature) {
      return null
    }

    const header = JSON.parse(new TextDecoder().decode(fromBase64Url(headerValue))) as {
      alg?: string
    }
    const payload = JSON.parse(
      new TextDecoder().decode(fromBase64Url(payloadValue)),
    ) as TokenPayload
    const now = Math.floor(Date.now() / 1000)
    if (
      header.alg !== "HS256" ||
      payload.iss !== env.JWT_ISSUER ||
      payload.aud !== env.JWT_AUDIENCE ||
      payload.exp <= now ||
      !payload.sub ||
      !payload.unique_name
    ) {
      return null
    }
    return { id: payload.sub, username: payload.unique_name }
  } catch {
    return null
  }
}

export function readBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) {
    return null
  }
  const token = header.slice("Bearer ".length).trim()
  return token || null
}
