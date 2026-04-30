import { defineConfig } from '@farmfe/core'

export default defineConfig(({ mode }) => ({
  envDir: '..',
  plugins: ['@farmfe/plugin-react'],
  compilation: {
    output: {
      publicPath: mode === 'production' ? '/public/' : '/',
    },
  },
}))
