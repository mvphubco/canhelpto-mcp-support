import { test } from "node:test";
import assert from "node:assert/strict";
import { createSupport, supportTools, SUPPORT_TOOL_NAMES, SUPPORT_READ_ONLY } from "../src/index.js";

// 2026-11-11 (operator: "we don't need 2 implementations"): Gigi and PromptHire kept
// their own copies of these tools because withSupport() only works by wrapping
// server.registerTool. createSupport() is the same engine for servers with their
// own registration loop.

type Acct = { id: string; name: string; email: string | null; team: string | null };
const maria: Acct = { id: "u_1", name: "Maria Lopez", email: "maria@northwind.com", team: "member" };

function api() {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: any }> = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify({ success: true, ticket: { id: "t_9", status: "OPEN" } }), { status: 201 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

test("the catalogue is the same five tools for any product, two of them reads", () => {
  assert.deepEqual(supportTools("Gigi").map((t) => t.name), [...SUPPORT_TOOL_NAMES]);
  assert.deepEqual([...SUPPORT_READ_ONLY], ["support_ask", "support_ticket_status"]);
  assert.match(supportTools("DevStaff.ai").find((t) => t.name === "support_open_ticket")!.description, /DevStaff\.ai team/);
});

test("support_ask answers from a rule shaped to the account and lists the account's recent errors", async () => {
  const s = createSupport<Acct>({ apiKey: "chs_x", product: "Gigi", rules: [{ match: /credit/i, answer: (a) => (a.team === "member" ? "Billing sits with the team owner." : "Use buy_credits.") }] });
  s.record("u_1", { tool: "approve_drafts", at: "2026-11-11T10:00:00.000Z", ms: 90, ok: false, error: "FORBIDDEN: nope" });
  s.record("u_1", { tool: "support_ask", at: "2026-11-11T10:01:00.000Z", ms: 1, ok: false, error: "not recorded" });
  const r = await s.call("support_ask", { question: "where are my credits" }, maria);
  assert.equal(r.isError, false);
  assert.match(r.text, /^Billing sits with the team owner\.\nRecent errors on this account:\n- 10:00:00 approve_drafts: FORBIDDEN: nope\n/);
  assert.equal(s.recentCalls("u_1").length, 1, "support tools are never recorded");
});

test("a ticket carries the app's tags and page, the recorded calls and the client", async () => {
  const { calls, fetchImpl } = api();
  const s = createSupport<Acct>({ apiKey: "chs_x", product: "Gigi", tags: ["claude-connector"], page: "mcp://gigi", fetch: fetchImpl });
  s.record("u_1", { tool: "list_drafts", at: "2026-11-11T10:00:00.000Z", ms: 12, ok: true });
  const r = await s.call("support_open_ticket", { subject: "Drafts fail", message: "Approving fails." }, maria, { userAgent: "claude-user/1.0", catalogue: "1.17.0" });
  assert.match(r.text, /Ticket t_9 is with the Gigi team/);
  const b = calls[0]!.body;
  assert.deepEqual(b.tags, ["mcp", "claude-connector", "question"]);
  assert.equal(b.page, "mcp://gigi");
  assert.equal(b.metadata.mcp.account.team, "member");
  assert.equal(b.metadata.mcp.client.catalogue, "1.17.0");
  assert.match(b.message, /Client: claude-user\/1\.0 · catalogue 1\.17\.0\nLast calls \(newest first\):\n- 10:00:00 list_drafts · 12 ms · ok$/);
});

test("bad input and a missing account are errors, and nothing is sent", async () => {
  const { calls, fetchImpl } = api();
  const s = createSupport<Acct>({ apiKey: "chs_x", product: "Gigi", fetch: fetchImpl });
  assert.equal((await s.call("support_set_ticket_status", { ticketId: "t", status: "RESOLVED" }, maria)).isError, true);
  assert.match((await s.call("support_open_ticket", { subject: "abc", message: "abc" }, null)).text, /Sign in first/);
  assert.equal(calls.length, 0);
});
