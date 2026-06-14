// Optional Google Analytics 4 (gtag.js) integration.
//
// Fully gated behind the build-time env var VITE_GA_MEASUREMENT_ID. With no id
// configured this module is a complete no-op: no script is injected, no
// network request is made, and every exported function returns immediately. So
// local dev and any deploy without the id are entirely unaffected.
//
// VITE_GA_MEASUREMENT_ID is a BUILD-time variable (Vite only inlines
// VITE_-prefixed vars), so it must be set before `yarn build`.

type GtagFn = (...args: unknown[]) => void

declare global {
    interface Window {
        dataLayer?: unknown[]
        gtag?: GtagFn
    }
}

// Captured once at import. `undefined` (the default when the var is unset) means
// analytics is off everywhere below.
const GA_ID: string | undefined = import.meta.env.VITE_GA_MEASUREMENT_ID

// Enabled only when an id is configured AND a browser DOM exists. The DOM check
// guards SSR and node test runs, where `document` is absent.
export function analyticsEnabled(): boolean {
    return typeof GA_ID === "string" && GA_ID.length > 0 && typeof document !== "undefined"
}

// Guard against injecting the script or re-defining gtag more than once.
let initialized = false

// Inject the standard gtag.js snippet for GA_ID. Idempotent and safe to call
// when disabled (returns immediately). Wrapped so a failure can never break the
// app at startup.
export function initAnalytics(): void {
    if (initialized) return
    if (!analyticsEnabled()) return
    try {
        const id = GA_ID as string
        window.dataLayer = window.dataLayer || []
        const gtag: GtagFn = function gtag(...args: unknown[]) {
            window.dataLayer?.push(args)
        }
        window.gtag = gtag

        const script = document.createElement("script")
        script.async = true
        script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`
        document.head.appendChild(script)

        gtag("js", new Date())
        gtag("config", id, { anonymize_ip: true })

        initialized = true
    } catch (e) {
        console.warn("analytics init failed", e)
    }
}

// Track a custom event. No-op when disabled. Never throws.
export function trackEvent(name: string, params?: Record<string, unknown>): void {
    if (!analyticsEnabled()) return
    try {
        window.gtag?.("event", name, params ?? {})
    } catch (e) {
        console.warn("analytics event failed", e)
    }
}

// Track a page view for the given path. No-op when disabled. Never throws.
export function trackPageView(path: string): void {
    if (!analyticsEnabled()) return
    try {
        window.gtag?.("event", "page_view", { page_path: path })
    } catch (e) {
        console.warn("analytics page view failed", e)
    }
}
