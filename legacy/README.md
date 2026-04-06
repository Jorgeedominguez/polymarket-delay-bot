This folder contains the archived pre-TypeScript bot.

It is intentionally no longer the main implementation.

Reasons:
- Authentication and order signing were handwritten instead of delegated to the official Polymarket SDK.
- Market discovery, pricing, signal generation, order execution, and monitoring were mixed into one file.
- Polling and simplified placeholder logic made it unsuitable for live or shadow execution with auditable behavior.

The new project entrypoint is `src/app/main.ts`.
