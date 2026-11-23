import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSupport, supportTools, withSupport, SUPPORT_TOOL_NAMES } from "../src/index.js";

// Ticket cmw3eiafc (Irina, 20 Nov 2026): the ticket tools worked only on tickets opened
// from her own account; on tickets Marco or the operator opened about her requests the
// connector answered "not found on your account". An admin of the host app now lists,
// reads, answers and reopens every ticket of the workspace, and her reply is a team
// reply under her name, never one written as the ticket's customer.

type Acct = { id: string; name: string; email: string | null; role: string };
const irina: Acct = { id: "u_irina", name: "Irina Stoicescu", email: "irina@usegigi.ai", role: "admin" };
const maria: Acct = { id: "u_maria", name: "Maria Lopez", email: "maria@northwind.com", role: "user" };

// Shapes as GET /api/v1/tickets/:id returns them (customer mode: no internal replies).
const marcoTicket = {
  id: "t_marco", status: "RESOLVED", priority: "HIGH", summary: "Partners network", customerName: "Marco Agent", customerEmail: "marco@mvphub.co",
  message: "Irina asks for a partners network.\n\n- Connector context (attached by Gigi's MCP support) -\nAccount: Marco", metadata: null, createdAt: "2026-11-19T09:00:00.000Z",
  replies: [
    { id: "r1", message: "Scoped for next sprint.", isAI: false, isInternal: false, userId: "staff_1" },
    { id: "r2", message: "From Lucian Cretu (lucian.cretu@mvphub.co), Gigi team:\n\nPinged Gabriel.", isAI: false, isInternal: false, userId: null },
    { id: "r3", message: "Any news?", isAI: false, isInternal: false, userId: null },
  ],
};
const internalNote = { id: "r4", message: "internal: do not show", isAI: false, isInternal: true, userId: "staff_1" };

function fakeApi() {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: any }> = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers as Record<string, string>) ?? {};
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method: init.method ?? "GET", headers, body });
    if (init.method === "POST") return new Response(JSON.stringify({ success: true, reply: { id: "r_new" } }), { status: 201 });
    if (init.method === "PATCH") return new Response(JSON.stringify({ success: true, ticket: { id: "t_marco", status: body.status } }), { status: 200 });
    if (url.endsWith("/tickets/t_marco")) return new Response(JSON.stringify(marcoTicket), { status: 200 });
    if (url.includes("/tickets?")) {
      const status = new URL(url).searchParams.get("status");
      const rows = [
        { ...marcoTicket, status: "OPEN", replies: [...marcoTicket.replies, internalNote] },
        { id: "t_2", status: "IN_PROGRESS", priority: "MEDIUM", summary: "Import custom company lists", customerName: "Lucian Cretu", customerEmail: "lucian.cretu@mvphub.co", createdAt: "2026-11-20T09:00:00.000Z", replies: [internalNote] },
      ].filter((t) => !status || t.status === status);
      return new Response(JSON.stringify({ tickets: rows }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "Ticket not found" }), { status: 404 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const engine = (api: ReturnType<typeof fakeApi>) =>
  createSupport<Acct>({ apiKey: "chs_x", product: "Gigi", fetch: api.fetchImpl, canSeeAllTickets: (a) => a.role === "admin" });

test("an admin reads a ticket someone else opened, without internal notes, and with each reply's author", async () => {
  const api = fakeApi();
  const r = await engine(api).call("support_ticket_status", { ticketId: "t_marco" }, irina);
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /t_marco · RESOLVED · Partners network/);
  assert.match(r.text, /From: Marco Agent <marco@mvphub\.co>/);
  assert.match(r.text, /- Gigi team: Scoped for next sprint\./);
  assert.match(r.text, /- Lucian Cretu \(lucian\.cretu@mvphub\.co\): Pinged Gabriel\./);
  assert.match(r.text, /- customer Marco Agent <marco@mvphub\.co>: Any news\?/);
  assert.doesNotMatch(r.text, /Connector context/);
  assert.ok(api.calls.every((c) => !("X-Service-Mode" in c.headers)), "a read stays in customer mode, so internal notes never come back");
});

test("an admin's reply on someone else's ticket is a team reply under her name, and it reopens a resolved ticket", async () => {
  const api = fakeApi();
  const r = await engine(api).call("support_reply_to_ticket", { ticketId: "t_marco", message: " Partners page is live on staging. " }, irina);
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /team reply from Irina Stoicescu[\s\S]*open again/);
  const post = api.calls.find((c) => c.method === "POST")!;
  assert.equal(post.url, "https://canhelpto.com/api/v1/tickets/t_marco/replies");
  assert.equal(post.headers["X-Service-Mode"], "true");
  assert.equal(post.body.email, undefined, "never written as the ticket's customer");
  assert.equal(post.body.isInternal, false);
  assert.equal(post.body.message, "From Irina Stoicescu (irina@usegigi.ai), Gigi team:\n\nPartners page is live on staging.");
  const patch = api.calls.find((c) => c.method === "PATCH")!;
  assert.equal(patch.url, "https://canhelpto.com/api/v1/tickets/t_marco");
  assert.deepEqual(patch.body, { status: "OPEN" });
  assert.equal(patch.headers["X-Service-Mode"], "true");
});

test("an admin reopens or closes someone else's ticket in team mode, never with the customer's email", async () => {
  const api = fakeApi();
  const s = engine(api);
  assert.match((await s.call("support_set_ticket_status", { ticketId: "t_marco", status: "OPEN" }, irina)).text, /open again/);
  assert.match((await s.call("support_set_ticket_status", { ticketId: "t_marco", status: "CLOSED" }, irina)).text, /is closed/);
  const patches = api.calls.filter((c) => c.method === "PATCH");
  assert.deepEqual(patches.map((c) => [c.url, c.body]), [
    ["https://canhelpto.com/api/v1/tickets/t_marco", { status: "OPEN" }],
    ["https://canhelpto.com/api/v1/tickets/t_marco", { status: "CLOSED" }],
  ]);
});

test("support_list_tickets lists the workspace's active tickets for an admin, counting only public replies", async () => {
  const api = fakeApi();
  const r = await engine(api).call("support_list_tickets", {}, irina);
  assert.equal(r.isError, false, r.text);
  const lines = r.text.split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^t_2 · IN_PROGRESS · MEDIUM · Import custom company lists · from Lucian Cretu <lucian\.cretu@mvphub\.co> · 2026-11-20 · 0 replies$/);
  assert.match(lines[1], /^t_marco · OPEN · HIGH · Partners network · from Marco Agent <marco@mvphub\.co> · 2026-11-19 · 3 replies$/);
  assert.doesNotMatch(r.text, /do not show/);
  const lists = api.calls.filter((c) => c.url.includes("/tickets?"));
  assert.deepEqual(lists.map((c) => new URL(c.url).searchParams.get("status")), ["OPEN", "IN_PROGRESS"]);
  assert.ok(lists.every((c) => c.headers["X-Service-Mode"] === "true" && !new URL(c.url).searchParams.has("email")));
  const high = await engine(fakeApi()).call("support_list_tickets", { status: "all", priority: "HIGH", limit: 5 }, irina);
  assert.equal(high.isError, false);
});

test("without canSeeAllTickets nothing changes: a user sees only their own tickets and cannot list the workspace", async () => {
  const api = fakeApi();
  const s = engine(api);
  assert.match((await s.call("support_ticket_status", { ticketId: "t_marco" }, maria)).text, /not found on your account/);
  assert.equal((await s.call("support_reply_to_ticket", { ticketId: "t_marco", message: "hi" }, maria)).isError, true);
  assert.equal((await s.call("support_set_ticket_status", { ticketId: "t_marco", status: "OPEN" }, maria)).isError, true);
  assert.match((await s.call("support_list_tickets", {}, maria)).text, /for the Gigi team/);
  assert.equal(api.calls.filter((c) => c.method !== "GET" || c.url.includes("/tickets?")).length, 0);
  const plain = createSupport<Acct>({ apiKey: "chs_x", product: "Gigi", fetch: api.fetchImpl });
  assert.equal((await plain.call("support_ticket_status", { ticketId: "t_marco" }, irina)).isError, true, "default: admins too see only their own");
});

test("the team tool is in the catalogue only on request; withSupport registers it only with canSeeAllTickets", async () => {
  assert.deepEqual(supportTools("Gigi").map((t) => t.name), [...SUPPORT_TOOL_NAMES]);
  const teamTools = supportTools("Gigi", { team: true });
  assert.deepEqual(teamTools.map((t) => t.name), [...SUPPORT_TOOL_NAMES, "support_list_tickets"]);
  assert.equal(teamTools.find((t) => t.name === "support_list_tickets")!.readOnly, true);
  assert.match(teamTools.find((t) => t.name === "support_reply_to_ticket")!.description, /team reply under your name[\s\S]*Confirm the text with the user first\.$/);
  assert.match(teamTools.find((t) => t.name === "support_set_ticket_status")!.description, /Confirm with the user first\.$/);

  const names = async (canSeeAllTickets?: (a: Acct) => boolean) => {
    const server = new McpServer({ name: "acme", version: "1.0.0" });
    withSupport<Acct>(server, { apiKey: "chs_x", product: "Acme", user: () => irina, canSeeAllTickets, fetch: fakeApi().fetchImpl });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "1.0.0" });
    await Promise.all([server.connect(a), client.connect(b)]);
    return (await client.listTools()).tools.map((t) => t.name);
  };
  assert.ok(!(await names()).includes("support_list_tickets"));
  assert.ok((await names((a) => a.role === "admin")).includes("support_list_tickets"));
});
