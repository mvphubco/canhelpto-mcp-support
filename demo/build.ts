import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { withSupport } from "../src/index.js";

// A runnable reference: a made-up "Acme Invoices" server with support mounted.
// Directories (Glama) need a server that starts and answers introspection; vendors
// get a copyable example. Without CANHELPTO_API_KEY, support_open_ticket reports HTTP 401.

export function buildDemoServer(env: Record<string, string | undefined> = process.env, fetchImpl?: typeof fetch): McpServer {
  const server = new McpServer({ name: "acme-invoices-demo", version: "1.0.0" });

  withSupport(server, {
    apiKey: env.CANHELPTO_API_KEY ?? "",
    product: "Acme Invoices (demo)",
    user: () => ({ id: "demo-user", name: "Demo user", email: env.DEMO_USER_EMAIL }),
    rules: [
      { match: ["currency", "chf"], answer: "Only EUR and USD are enabled on demo accounts. Ask support to enable another currency.", nextTool: "support_open_ticket" },
      { match: ["due date"], answer: "A sent invoice is locked; void it and create a new one with the new due date." },
    ],
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });

  server.registerTool(
    "list_invoices",
    { title: "List invoices", description: "Lists the demo account's invoices.", inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => ({ content: [{ type: "text" as const, text: "INV-1001 · Northwind · EUR 1,200 · paid\nINV-1002 · Contoso · USD 640 · sent" }] }),
  );

  server.registerTool(
    "create_invoice",
    {
      title: "Create invoice",
      description: "Creates an invoice. Only EUR and USD are enabled on the demo account, so other currencies fail on purpose.",
      inputSchema: { client: z.string(), amount: z.number(), currency: z.string().length(3) },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ client, amount, currency }) => {
      const cur = currency.toUpperCase();
      if (cur !== "EUR" && cur !== "USD") return { content: [{ type: "text" as const, text: `currency ${cur} not enabled for this account` }], isError: true };
      return { content: [{ type: "text" as const, text: `Created INV-1003 for ${client}: ${cur} ${amount}` }] };
    },
  );

  return server;
}
