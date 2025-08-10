import { defineConfig } from '@farmfe/core'

export default defineConfig({
  envDir: '..',
  plugins: ['@farmfe/plugin-react'],
  compilation: {
    output: {
      publicPath: '/public/',
    },
  },
})
