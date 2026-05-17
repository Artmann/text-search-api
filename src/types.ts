export type Bindings = CloudflareBindings & {
  API_TOKEN: string
}

export type AppEnv = { Bindings: Bindings }
