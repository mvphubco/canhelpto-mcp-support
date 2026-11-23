# @canhelpto-com/mcp-support

Customer support inside your MCP server. Your users are in Claude, ChatGPT and Cursor now; when one of your tools fails there, they have no help button. This package adds one.

- `support_ask` answers from your own rules (no model call, never invented).
- `support_open_ticket` opens a ticket with the account, the client and the last tool calls attached, errors included.
- `support_ticket_status` brings your team's answer back into the user's chat.
- `support_reply_to_ticket` lets the user answer the team or add details on their own ticket (a reply on a closed ticket reopens it).
- `support_set_ticket_status` lets the user close their ticket when it is solved, or reopen it.
- `support_list_tickets` (only for your own team, see `canSeeAllTickets`) lists every ticket of the workspace; your team can then read, answer and reopen any of them from the chat.
- Every tool you register after it is timed and recorded, and its errors carry a hint that tells the agent where to turn.

Tickets land in your [canhelpto](https://canhelpto.com/?utm_source=mcp-support-readme) inbox with the failed call shown next to the customer's words. Your team answers there or from its own agent. Free for one workspace.

## Install with one prompt

Tell your coding agent (Claude Code, Cursor, Codex):

> Add canhelpto support to this MCP server, following https://canhelpto.com/install.md

It reads your server, adds the package, wires the user lookup and opens a test ticket.

## Install by hand

```bash
npm install @canhelpto-com/mcp-support
```

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withSupport } from "@canhelpto-com/mcp-support";

const server = new McpServer({ name: "acme", version: "1.0.0" });

withSupport(server, {
  apiKey: process.env.CANHELPTO_API_KEY!,   // canhelpto.com -> Settings -> Service key (chs_...)
  product: "Acme Invoices",
  user: (extra) => lookupUser(extra),        // { id, name?, email?, ...anything you want the team to see }
  rules: [
    { match: ["domain", "dns"], answer: "Verify your sender domain in Settings > Email.", nextTool: "get_settings" },
    { match: /rate.?limit/i, answer: "You hit the rate limit; it resets after 60 seconds." },
  ],
});

// Register your own tools after withSupport, as usual.
server.registerTool("send_invoice", { inputSchema: { invoiceId: z.string() } }, async ({ invoiceId }) => { /* ... */ });
```

Call `withSupport` before registering your own tools: those registered after it are recorded and get the error hint.

## Options

| Option | |
| --- | --- |
| `apiKey` | Workspace service key (`chs_...`). Server-side only. |
| `product` | Your product's name, used in tool descriptions and the ticket. |
| `user(extra)` | Returns the calling account, or null. `extra` is the MCP request context (`authInfo`, session). |
| `rules` | Answers for `support_ask`, matched on words or a pattern; an answer can be a function of the account. |
| `page` | The ticket's page (default `mcp://<product>`). `tags` is ignored since 0.5.0: canhelpto marks connector tickets with Source MCP. |
| `client(extra)` | What the caller runs (`userAgent`, your catalogue version). |
| `canSeeAllTickets(account)` | True for your own team (e.g. admins). They get `support_list_tickets` and can read, answer, close and reopen any ticket of the workspace; a reply on someone else's ticket is posted as a team reply starting "From <name> (<email>), <product> team:", never as the ticket's customer, and no email is sent. Internal notes stay hidden. Default: nobody. |
| `keep` | Calls kept per user. Default 12. |
| `baseUrl`, `fetch` | For tests and self-hosting. |

## Your own registration loop

A server that registers its tools in its own loop (role-shaped catalogues, its own call recording) uses the same engine without the wrapper:

```ts
import { createSupport, supportTools } from "@canhelpto-com/mcp-support";

const support = createSupport({ apiKey: process.env.CANHELPTO_API_KEY!, product: "Acme", rules, canSeeAllTickets: (a) => isAdmin(a) });
for (const t of supportTools("Acme", { team: isAdmin(account) })) {   // { team: true } adds support_list_tickets
  // register t.name with t.title, t.description, t.inputSchema (a zod shape) and t.readOnly
  // handler: (args) => support.call(t.name, args, account, { userAgent }) -> { text, isError }
}
// after each of your own tool calls:
support.record(account.id, { tool, at: new Date().toISOString(), ms, ok, error });
```

## Privacy

The ticket carries the account fields you return from `user()`, the client fields, and the names, times, durations and error messages of the last calls. Tool arguments and results are never sent. Reads never use service mode, so your team's internal notes stay out of the chat, and a user only sees tickets on their own account (your team, with `canSeeAllTickets`, sees the workspace's tickets without internal notes).

## License

MIT, MVPHub LLC.

## Demo server

`demo/` is a runnable example: a made-up "Acme Invoices" server with support mounted (`create_invoice` fails on purpose for currencies other than EUR and USD). Run it over stdio with `npx tsx demo/server.ts`, or `docker build -t canhelpto-demo . && docker run -i canhelpto-demo`. Set `CANHELPTO_API_KEY` to file real tickets in your workspace.
