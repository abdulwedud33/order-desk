# Architectural and Implementation Decisions

This document records deliberate deviations from planning documents or specific architectural decisions made to preserve security, correctness, and reliability.

## Milestone M0 Decisions (2026-11-21)

1. **DEC-001: Next.js Static Export Architecture (`next.config.mjs`)**
   - **Decision:** Configured Next.js with `output: 'export'`, `trailingSlash: true`, `images: { unoptimized: true }`, `poweredByHeader: false`.
   - **Reason:** Satisfies the strict architectural constraint in `docs/02-technical-requirements.md` that the entire front-end is statically hosted on a CDN with zero server-side rendering at request time. All dynamic operations occur client-side (local-first via Dexie) or via Supabase RPCs/Edge Functions.

2. **DEC-002: Per-Page CSP Generation (`scripts/postbuild.mjs`)**
   - **Decision:** A post-build script hashes all inline scripts emitted by Next.js static export using SHA-256 and writes an `out/_headers` file.
   - **Reason:** Completely removes the need for `'unsafe-inline'` in `script-src`, strictly enforcing `docs/security.md` section 10.

3. **DEC-003: CI Static Bundle Secret Scanner (`scripts/check-bundle.mjs`)**
   - **Decision:** Added post-build bundle verification scanning all files in `out/` for `service_role`, Anthropic/model provider keys, and non-anon JWTs.
   - **Reason:** Non-negotiable security rule 1 (`docs/security.md` section 3): only the Supabase public URL and anon key may ship in client bundles. Any accidental bundling of elevated credentials immediately aborts the build with exit code 1.

4. **DEC-004: Product Baseline Defaults (from `docs/01-prd.md` s6 & s11)**
   - **Decision:** Confirmed following answers to PRD open questions:
     - Pilot business template: Food template first (café/restaurant), followed by Repair, then Delivery extras.
     - Intake channels: Walk-in and phone orders; chat intake via text paste into assistant Quick Entry; Telegram bot deferred to v1.1.
     - Kitchen hardware: Staff phone or counter tablet; no physical printer in v1 (glanceable screen with audio/vibration).
     - Payment methods: Cash and mobile money (Telebirr, CBE Birr) recorded by staff; no third-party payment gateway integration in v1.
     - Languages: English (`en`), Amharic (`am`), Afaan Oromo (`om`).
     - Currency: Ethiopian Birr (ETB).

5. **DEC-005: Strict TypeScript & Test Isolation**
   - **Decision:** Strict TypeScript compiler configuration (`strict: true`, `noImplicitAny: true`, `noUncheckedIndexedAccess: true`). Included `fake-indexeddb` for Dexie domain and outbox unit tests without browser runtime overhead.
   - **Reason:** Domain code in `src/domain/` stays pure with zero framework/browser dependencies, enabling lightning-fast node test execution.
