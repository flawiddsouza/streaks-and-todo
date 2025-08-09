import { createAuthClient } from 'better-auth/client'
import { passkeyClient } from 'better-auth/client/plugins'
import { config } from './config'

export const authClient = createAuthClient({
  baseURL: config.apiBaseUrl,
  plugins: [passkeyClient()],
})
