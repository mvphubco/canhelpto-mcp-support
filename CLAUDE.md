# CLAUDE.md

`@canhelpto-com/mcp-support`: a TypeScript library. `withSupport()` adds `support_ask`, `support_open_ticket`, `support_ticket_status`, `support_reply_to_ticket` and `support_set_ticket_status` (plus `support_list_tickets` when the host passes `canSeeAllTickets`) to a vendor's MCP server and files tickets in canhelpto.com with the failed calls attached (`src/index.ts`).

## Stack and commands

- TypeScript (ESM), peer deps `@modelcontextprotocol/sdk` and `zod`.
- `npm run typecheck`, `npm test` (node:test via tsx, `test/*.test.ts`), `npm run build` (to `dist/`).

## Deploy

npm: `@canhelpto-com/mcp-support`, org `canhelpto-com` owned by the npm user `mvphub.co` (Lucian; the name `canhelpto` is held by an unrecoverable account). Publish: `npm publish --access public` from this folder after `npm login`. Push to `main`.

## Rules

- The connector-context header is `- Connector context (attached by <product>'s MCP support) -`; canhelpto's `src/lib/mcp-context.ts` parses it (and the older em dash form).
- No em dash in anything the library writes or shows (guard: `test/no-em-dash.test.ts`).

## Recent changes

- 2026-11-23: **0.5.0: follows canhelpto's type-only labels and named replies; ships 0.4.0 (operator: "you needed to republish a npm package").** npm still had 0.3.0, so `canSeeAllTickets` / `support_list_tickets` (0.4.0) never reached the apps (Irina asked for exactly that on 2026-11-23). `support_open_ticket` takes `type` issue|feature instead of `category` and sends no tags (canhelpto dropped category and the mcp/claude-connector tags; Source MCP marks connector tickets); the `tags` option is deprecated and ignored. Team replies show their author (`author` from canhelpto, e.g. "Marco (Gigi team)"), so an API reply without a userId is never shown as the user's own. Close still sends CLOSED (canhelpto stores it as RESOLVED). Tests: `support`, `engine`.
- 2026-11-23: **0.4.0: the host's own team sees every ticket (ticket cmw3eiafc, Irina; operator approved).** ROOT CAUSE (confirmed in code): every ticket tool checked ownership (`mine`: metadata userId or customer email), so an admin got "not found on your account" on tickets Marco or the operator opened about her requests, and a customer-mode reply on such a ticket would have been written as its customer (`email: t.customerEmail`). Option `canSeeAllTickets(account)` (default none): `support_list_tickets` (service-mode list, status active/OPEN/IN_PROGRESS/RESOLVED/all + priority, public reply count only), read any ticket (customer-mode GET, no internal notes, replies labelled by author), reply on someone else's ticket as a service-mode public reply whose first line is `From <name> (<email>), <product> team:` (the v1 API has no author field; no email is sent), close/reopen via service-mode PATCH; own tickets keep the customer path. `supportTools(product, { team })`, `SUPPORT_TEAM_TOOL_NAMES`; withSupport registers the team tool only with the option. Test: `team`.
- 2026-11-11 (2): **0.3.0: one engine for every app (operator: "we don't need 2 implementations").** ROOT CAUSE (confirmed in code): `withSupport` only worked by wrapping `server.registerTool`, so Gigi and PromptHire, which register tools in their own loops, kept their own copies of the support tools; the copies drifted (DevStaff's ticket list answered 403 in production on 2026-11-11, it read with the public key). `createSupport(opts)` is the engine (`call`, `record`, `recentCalls`, `hint`); `supportTools(product)`, `SUPPORT_TOOL_NAMES`, `SUPPORT_READ_ONLY`, `supportInputShapes` (zod shapes built with the app's own zod, typed loosely because zod 3 and 4 types differ). `withSupport` runs on it. New options: rule answers as a function of the account, `tags`, `page`; `support_ask` lists the account's recent errors. Every call uses the key passed (the service key). Test: `engine`.
- 2026-11-11: **0.2.0: the user can reply on, close and reopen their own ticket (operator).** `support_reply_to_ticket` (POST /api/v1/tickets/:id/replies, customer mode: a reply on a resolved/closed ticket reopens it and notifies the team) and `support_set_ticket_status` (PATCH /api/v1/tickets/:id/status, OPEN or CLOSED). Both check ownership first (`ownTicket`: metadata userId or email) and never send X-Service-Mode. Not published to npm yet (needs `npm login`). Test: `support`.
- 2026-10-13: **Demo server + Dockerfile (operator: awesome-mcp-servers needs a passing Glama check).** `demo/build.ts` (`buildDemoServer`: made-up Acme Invoices, `list_invoices`, `create_invoice` failing on non-EUR/USD, `withSupport` with two rules), `demo/server.ts` (stdio), `Dockerfile` (node:22-slim, `npx tsx demo/server.ts`). Not in the npm tarball. Test: `demo-server`.
- 2026-10-13: **Published name `@canhelpto-com/mcp-support` (operator).** The npm name `canhelpto` belongs to a user account registered with a misspelled email; the org `canhelpto-com` was created instead. Author contact canhelpto@canhelpto.com (hello@ never existed); README links tagged `utm_source=mcp-support-readme`, homepage `utm_source=npm`; the GitHub-install fallback line is gone. Guard: `test/package-identity.test.ts`.
- 2026-10-13: **No em dash (operator).** The connector-context header the library writes into every ticket used em dashes; it now uses hyphens (canhelpto parses both). Guard: `test/no-em-dash.test.ts`.
