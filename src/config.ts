export const config = {
  frontendUrl: process.env.FRONTEND_URL as string,
  notifications: {
    smtp: {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT
        ? Number.parseInt(process.env.SMTP_PORT)
        : undefined,
      user: process.env.SMTP_USER,
      password: process.env.SMTP_PASSWORD,
      from: process.env.SMTP_FROM || 'noreply@streaksandtodo.local',
    },
  },
}
