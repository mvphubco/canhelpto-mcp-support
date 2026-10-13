# CLAUDE.md

`@canhelpto/mcp-support`: a TypeScript library. `withSupport()` adds `support_ask`, `support_open_ticket` and `support_ticket_status` to a vendor's MCP server and files tickets in canhelpto.com with the failed calls attached (`src/index.ts`).

## Stack and commands

- TypeScript (ESM), peer deps `@modelcontextprotocol/sdk` and `zod`.
- `npm run typecheck`, `npm test` (node:test via tsx, `test/*.test.ts`), `npm run build` (to `dist/`).

## Deploy

None. Not published to npm yet (`npm view @canhelpto/mcp-support` 404 on 2026-10-13); vendors install it from the GitHub repo. Push to `main`.

## Rules

- The connector-context header is `- Connector context (attached by <product>'s MCP support) -`; canhelpto's `src/lib/mcp-context.ts` parses it (and the older em dash form).
- No em dash in anything the library writes or shows (guard: `test/no-em-dash.test.ts`).

## Recent changes

- 2026-10-13: **No em dash (operator).** The connector-context header the library writes into every ticket used em dashes; it now uses hyphens (canhelpto parses both). Guard: `test/no-em-dash.test.ts`.
