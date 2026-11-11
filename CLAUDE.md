# CLAUDE.md

`@canhelpto-com/mcp-support`: a TypeScript library. `withSupport()` adds `support_ask`, `support_open_ticket`, `support_ticket_status`, `support_reply_to_ticket` and `support_set_ticket_status` to a vendor's MCP server and files tickets in canhelpto.com with the failed calls attached (`src/index.ts`).

## Stack and commands

- TypeScript (ESM), peer deps `@modelcontextprotocol/sdk` and `zod`.
- `npm run typecheck`, `npm test` (node:test via tsx, `test/*.test.ts`), `npm run build` (to `dist/`).

## Deploy

npm: `@canhelpto-com/mcp-support`, org `canhelpto-com` owned by the npm user `mvphub.co` (Lucian; the name `canhelpto` is held by an unrecoverable account). Publish: `npm publish --access public` from this folder after `npm login`. Push to `main`.

## Rules

- The connector-context header is `- Connector context (attached by <product>'s MCP support) -`; canhelpto's `src/lib/mcp-context.ts` parses it (and the older em dash form).
- No em dash in anything the library writes or shows (guard: `test/no-em-dash.test.ts`).

## Recent changes

- 2026-11-11 (2): **0.3.0: one engine for every app (operator: "we don't need 2 implementations").** ROOT CAUSE (confirmed in code): `withSupport` only worked by wrapping `server.registerTool`, so Gigi and PromptHire, which register tools in their own loops, kept their own copies of the support tools; the copies drifted (DevStaff's ticket list answered 403 in production on 2026-11-11, it read with the public key). `createSupport(opts)` is the engine (`call`, `record`, `recentCalls`, `hint`); `supportTools(product)`, `SUPPORT_TOOL_NAMES`, `SUPPORT_READ_ONLY`, `supportInputShapes` (zod shapes built with the app's own zod, typed loosely because zod 3 and 4 types differ). `withSupport` runs on it. New options: rule answers as a function of the account, `tags`, `page`; `support_ask` lists the account's recent errors. Every call uses the key passed (the service key). Test: `engine`.
- 2026-11-11: **0.2.0: the user can reply on, close and reopen their own ticket (operator).** `support_reply_to_ticket` (POST /api/v1/tickets/:id/replies, customer mode: a reply on a resolved/closed ticket reopens it and notifies the team) and `support_set_ticket_status` (PATCH /api/v1/tickets/:id/status, OPEN or CLOSED). Both check ownership first (`ownTicket`: metadata userId or email) and never send X-Service-Mode. Not published to npm yet (needs `npm login`). Test: `support`.
- 2026-10-13: **Demo server + Dockerfile (operator: awesome-mcp-servers needs a passing Glama check).** `demo/build.ts` (`buildDemoServer`: made-up Acme Invoices, `list_invoices`, `create_invoice` failing on non-EUR/USD, `withSupport` with two rules), `demo/server.ts` (stdio), `Dockerfile` (node:22-slim, `npx tsx demo/server.ts`). Not in the npm tarball. Test: `demo-server`.
- 2026-10-13: **Published name `@canhelpto-com/mcp-support` (operator).** The npm name `canhelpto` belongs to a user account registered with a misspelled email; the org `canhelpto-com` was created instead. Author contact canhelpto@canhelpto.com (hello@ never existed); README links tagged `utm_source=mcp-support-readme`, homepage `utm_source=npm`; the GitHub-install fallback line is gone. Guard: `test/package-identity.test.ts`.
- 2026-10-13: **No em dash (operator).** The connector-context header the library writes into every ticket used em dashes; it now uses hyphens (canhelpto parses both). Guard: `test/no-em-dash.test.ts`.
