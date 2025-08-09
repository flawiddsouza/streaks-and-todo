import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { passkey } from 'better-auth/plugins/passkey'
import { db } from './db'
import {
  accountsTable,
  passkeysTable,
  sessionsTable,
  usersTable,
  verificationsTable,
} from './db/auth-schema'

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: usersTable,
      session: sessionsTable,
      account: accountsTable,
      verification: verificationsTable,
      passkey: passkeysTable,
    },
  }),
  trustedOrigins: ['http://localhost:9000'],
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    passkey({
      rpID: process.env.PASSKEY_RP_ID || 'localhost',
      rpName: process.env.PASSKEY_RP_NAME || 'Streaks & Todo',
      origin: process.env.PASSKEY_ORIGIN || 'http://localhost:9008',
    }),
  ],
})
