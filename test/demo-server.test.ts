import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildDemoServer } from "../demo/build.js";

// Glama (and awesome-mcp-servers, which requires a passing Glama check) only lists a
// server that starts and answers introspection; the library alone is not a server.
async function connect(env: Record<string, string | undefined> = {}) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([buildDemoServer(env).connect(a), client.connect(b)]);
  return client;
}
const text = (r: any) => (r.content ?? []).map((c: any) => c.text).join("\n");

test("the demo server answers introspection with its tools and the three support tools", async () => {
  const client = await connect();
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["create_invoice", "list_invoices", "support_ask", "support_open_ticket", "support_ticket_status"]);
  for (const t of (await client.listTools()).tools.filter((t) => !t.name.startsWith("support_"))) {
    assert.ok(t.title, `${t.name} has a title`);
    assert.equal(typeof t.annotations?.readOnlyHint, "boolean");
  }
});

test("a failing demo tool points the agent at support, and support_ask answers from the demo rules", async () => {
  const client = await connect();
  const r = await client.callTool({ name: "create_invoice", arguments: { client: "Globex", amount: 90, currency: "CHF" } });
  assert.equal(r.isError, true);
  assert.match(text(r), /currency CHF not enabled[\s\S]*support_ask/);
  assert.match(text(await client.callTool({ name: "support_ask", arguments: { question: "Why can't I bill in CHF?" } })), /Only EUR and USD/);
});

test("the image runs the demo over stdio", () => {
  assert.ok(existsSync("Dockerfile"));
  assert.match(readFileSync("Dockerfile", "utf8"), /demo\/server\.ts/);
});
