import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { withSupport, answerFromRules, renderContext } from "../src/index.js";

type Req = { url: string; method: string; headers: Record<string, string>; body: any };

function fakeApi(tickets: Record<string, any> = {}) {
  const calls: Req[] = [];
  const fetchImpl = async (url: string | URL, init: RequestInit = {}) => {
    const u = String(url);
    const headers = Object.fromEntries(Object.entries((init.headers as Record<string, string>) ?? {}));
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: u, method: init.method ?? "GET", headers, body });
    if (init.method === "POST") return new Response(JSON.stringify({ success: true, ticket: { id: "t_1", status: "OPEN" } }), { status: 201 });
    const id = u.match(/tickets\/([^?]+)$/)?.[1];
    if (id && tickets[id]) return new Response(JSON.stringify(tickets[id]), { status: 200 });
    if (u.includes("?email=")) return new Response(JSON.stringify({ tickets: Object.values(tickets) }), { status: 200 });
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  };
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

async function connect(server: McpServer) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const text = (r: any) => (r.content ?? []).map((c: any) => c.text).join("\n");

function build(api = fakeApi()) {
  const server = new McpServer({ name: "acme", version: "1.0.0" });
  withSupport(server, {
    apiKey: "chs_test",
    product: "Acme Invoices",
    user: () => ({ id: "u_1", name: "Maria Lopez", email: "maria@northwind.com", plan: "pro" }),
    rules: [{ match: ["domain", "dns"], answer: "Verify your sender domain in Settings > Email.", nextTool: "get_settings" }],
    fetch: api.fetchImpl,
  });
  server.registerTool("send_invoice", { description: "Send an invoice", inputSchema: { invoiceId: z.string() } }, async ({ invoiceId }) => ({
    isError: true,
    content: [{ type: "text", text: `403 sender_domain_not_verified for ${invoiceId}` }],
  }));
  server.registerTool("list_invoices", { description: "List invoices" }, async () => ({ content: [{ type: "text", text: "INV-1042" }] }));
  return { server, api };
}

test("adds the three support tools next to the vendor's own", async () => {
  const { server } = build();
  const client = await connect(server);
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["list_invoices", "send_invoice", "support_ask", "support_open_ticket", "support_ticket_status"]);
});

test("a failing tool gets the support hint, and the call is recorded for the ticket", async () => {
  const { server, api } = build();
  const client = await connect(server);
  const failed = await client.callTool({ name: "send_invoice", arguments: { invoiceId: "INV-1042" } });
  assert.match(text(failed), /403 sender_domain_not_verified/);
  assert.match(text(failed), /support_ask/);
  await client.callTool({ name: "list_invoices", arguments: {} });
  await client.callTool({ name: "support_open_ticket", arguments: { subject: "Cannot send invoices", message: "Sending INV-1042 fails." } });
  const post = api.calls.find((c) => c.method === "POST")!;
  assert.equal(post.url, "https://canhelpto.com/api/v1/tickets");
  assert.equal(post.headers["X-API-Key"], "chs_test");
  assert.equal(post.headers["X-Service-Mode"], "true");
  const calls = post.body.metadata.mcp.recentCalls;
  assert.deepEqual(calls.map((c: any) => `${c.tool}:${c.ok}`), ["list_invoices:true", "send_invoice:false"]);
  assert.match(calls[1].error, /sender_domain_not_verified/);
  assert.equal(post.body.metadata.mcp.account.userId, "u_1");
  assert.equal(post.body.customerEmail, "maria@northwind.com");
  assert.match(post.body.message, /^Sending INV-1042 fails\.\n\n— Connector context \(attached by Acme Invoices's MCP support\) —/);
  assert.ok(post.body.tags.includes("mcp"));
  assert.equal(post.body.page, "mcp://acme-invoices");
});

test("support_ask answers from the vendor's rules, never invents, and points to the ticket tool otherwise", async () => {
  const { server } = build();
  const client = await connect(server);
  assert.match(text(await client.callTool({ name: "support_ask", arguments: { question: "why does my DNS fail" } })), /Verify your sender domain[\s\S]*get_settings/);
  assert.match(text(await client.callTool({ name: "support_ask", arguments: { question: "can I export to PDF" } })), /support_open_ticket/);
});

test("support_ticket_status shows only the caller's own ticket", async () => {
  const api = fakeApi({
    t_1: { id: "t_1", status: "IN_PROGRESS", summary: "Cannot send", metadata: { mcp: { account: { userId: "u_1" } } }, replies: [{ message: "Add the two DNS records.", userId: "staff", isInternal: false }] },
    t_2: { id: "t_2", status: "OPEN", summary: "Someone else", customerEmail: "other@x.com", metadata: { mcp: { account: { userId: "u_9" } } }, replies: [] },
  });
  const { server } = build(api);
  const client = await connect(server);
  assert.match(text(await client.callTool({ name: "support_ticket_status", arguments: { ticketId: "t_1" } })), /IN_PROGRESS[\s\S]*Add the two DNS records/);
  assert.match(text(await client.callTool({ name: "support_ticket_status", arguments: { ticketId: "t_2" } })), /not found/i);
  const reads = api.calls.filter((c) => c.method === "GET");
  assert.ok(reads.every((c) => !("X-Service-Mode" in c.headers)), "reads never use service mode (internal notes stay out)");
});

test("pure helpers: rules match words or patterns; the context block reads like the inbox expects", () => {
  assert.equal(answerFromRules("rate limit hit", [{ match: /rate.?limit/i, answer: "Wait 60 s." }])?.answer, "Wait 60 s.");
  assert.equal(answerFromRules("hello", [{ match: ["billing"], answer: "x" }]), null);
  const block = renderContext("Acme", { account: { userId: "u_1", fullName: "Maria" }, client: { userAgent: "claude-ai/1.0" }, recentCalls: [{ tool: "send_invoice", at: "2026-10-06T16:05:00.000Z", ms: 120, ok: false, error: "403" }] });
  assert.match(block, /^— Connector context \(attached by Acme's MCP support\) —\nAccount: Maria · u_1\nClient: claude-ai\/1\.0\nLast calls \(newest first\):\n- 16:05:00 send_invoice · 120 ms · 403$/);
});
