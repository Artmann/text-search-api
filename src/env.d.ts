declare module 'cloudflare:test' {
  interface ProvidedEnv extends CloudflareBindings {
    API_TOKEN: string
  }
}
