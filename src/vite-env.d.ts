/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Gemini key is server-side only (see api/court-judge.js, Plan 01-02); not exposed to client.
  readonly VITE_POSTHOG_KEY?: string
  readonly VITE_POSTHOG_HOST?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
