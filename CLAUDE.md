# CLAUDE.md

`@canhelpto-com/mcp-support`: a TypeScript library. `withSupport()` adds `support_ask`, `support_open_ticket` and `support_ticket_status` to a vendor's MCP server and files tickets in canhelpto.com with the failed calls attached (`src/index.ts`).

## Stack and commands

- TypeScript (ESM), peer deps `@modelcontextprotocol/sdk` and `zod`.
- `npm run typecheck`, `npm test` (node:test via tsx, `test/*.test.ts`), `npm run build` (to `dist/`).

## Deploy

npm: `@canhelpto-com/mcp-support`, org `canhelpto-com` owned by the npm user `mvphub.co` (Lucian; the name `canhelpto` is held by an unrecoverable account). Publish: `npm publish --access public` from this folder after `npm login`. Push to `main`.

## Rules

- The connector-context header is `- Connector context (attached by <product>'s MCP support) -`; canhelpto's `src/lib/mcp-context.ts` parses it (and the older em dash form).
- No em dash in anything the library writes or shows (guard: `test/no-em-dash.test.ts`).

## Recent changes

- 2026-10-13: **Demo server + Dockerfile (operator: awesome-mcp-servers needs a passing Glama check).** `demo/build.ts` (`buildDemoServer`: made-up Acme Invoices, `list_invoices`, `create_invoice` failing on non-EUR/USD, `withSupport` with two rules), `demo/server.ts` (stdio), `Dockerfile` (node:22-slim, `npx tsx demo/server.ts`). Not in the npm tarball. Test: `demo-server`.
- 2026-10-13: **Published name `@canhelpto-com/mcp-support` (operator).** The npm name `canhelpto` belongs to a user account registered with a misspelled email; the org `canhelpto-com` was created instead. Author contact canhelpto@canhelpto.com (hello@ never existed); README links tagged `utm_source=mcp-support-readme`, homepage `utm_source=npm`; the GitHub-install fallback line is gone. Guard: `test/package-identity.test.ts`.
- 2026-10-13: **No em dash (operator).** The connector-context header the library writes into every ticket used em dashes; it now uses hyphens (canhelpto parses both). Guard: `test/no-em-dash.test.ts`.
