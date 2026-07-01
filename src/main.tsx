import React from 'react'
import ReactDOM from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import posthog from 'posthog-js'
import App from './App'
import './index.css'
import { StorageAdapter } from './storage-adapter'
import { identifyPlayer } from './court-identity'

if (import.meta.env.VITE_POSTHOG_KEY) {
  posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
    api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
    ui_host: 'https://us.posthog.com',
    person_profiles: 'identified_only',
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
  })
  // Stamp every PostHog event with the platform. iOS WKWebView has $host=localhost
  // (capacitor.config.ts ios.scheme:'App'), so host filters drop it; app_platform is
  // the canonical dimension instead. register_once: Capacitor.getPlatform() is stable
  // per app lifetime, so set-once is correct.
  posthog.register_once({ app_platform: Capacitor.getPlatform() })
  // VAL-01: identify a RETURNING player whose id is already in storage at load, so D1/D7
  // retention cohorts (empty under person_profiles:'identified_only' until identify runs)
  // key on the anonymous player_id. A genuine FIRST launch has no id yet here (it is minted
  // async in RoundScreen) — identifyPlayer() is a truthy-id-guarded no-op in that case and
  // the first-launch identify happens post-mint in RoundScreen. No person-props → no PII.
  identifyPlayer()
}

async function bootstrap() {
  await StorageAdapter.init()
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

bootstrap()
