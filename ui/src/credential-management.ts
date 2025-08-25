import { authClient } from './auth-client'

type PasswordCredInit = { id: string; name?: string; password: string }
type PasswordCredentialCtor = new (init: PasswordCredInit) => unknown

function getNavigatorCredentials() {
  if (typeof navigator === 'undefined') return null
  const n = navigator as unknown as {
    credentials?: {
      store?: (cred: unknown) => Promise<unknown>
      get?: (options: unknown) => Promise<unknown>
    }
  }
  return n.credentials ?? null
}

function getPasswordCredentialCtor(): PasswordCredentialCtor | null {
  if (typeof window === 'undefined') return null
  const ctor = (window as unknown as Record<string, unknown>).PasswordCredential
  return typeof ctor === 'function' ? (ctor as PasswordCredentialCtor) : null
}

export function isCredentialApiSupported(): boolean {
  return !!getNavigatorCredentials() && !!getPasswordCredentialCtor()
}

export async function storePasswordCredential(id: string, password: string) {
  const creds = getNavigatorCredentials()
  const Ctor = getPasswordCredentialCtor()
  if (!creds || !Ctor) return
  try {
    const cred = new Ctor({ id, name: id, password })
    await creds.store?.(cred)
  } catch {
    // ignore failures silently
  }
}

export async function getStoredPasswordCredential(options?: {
  mediation?: 'optional' | 'silent' | 'required'
}): Promise<{ id: string; password: string } | null> {
  const creds = getNavigatorCredentials()
  if (!creds) return null
  try {
    const result = (await creds.get?.({
      // The "password: true" option is non-standardly typed; pass-through as unknown
      password: true,
      mediation: options?.mediation ?? 'optional',
    } as unknown)) as { id?: string; password?: string } | null
    if (result?.id && result?.password) {
      return { id: result.id, password: result.password }
    }
    return null
  } catch {
    return null
  }
}

export async function attemptAutoSignIn(): Promise<boolean> {
  const cred = await getStoredPasswordCredential({ mediation: 'optional' })
  if (!cred?.id || !cred?.password) return false
  try {
    const { error } = await authClient.signIn.email({
      email: cred.id,
      password: cred.password,
    })
    return !error
  } catch {
    return false
  }
}

export async function preventSilentCredentialAccess(): Promise<void> {
  try {
    if (typeof navigator === 'undefined') return
    const n = navigator as unknown as {
      credentials?: { preventSilentAccess?: () => Promise<void> }
    }
    await n.credentials?.preventSilentAccess?.()
  } catch {
    // ignore
  }
}
