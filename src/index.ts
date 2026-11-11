import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Customer support inside your MCP server (canhelpto.com).
 *
 *   const server = new McpServer({ name: "acme", version: "1.0.0" });
 *   withSupport(server, { apiKey: process.env.CANHELPTO_API_KEY!, product: "Acme", user: (extra) => myUser(extra) });
 *   // then register your own tools as usual
 *
 * A server with its own registration loop uses createSupport() instead: it
 * registers supportTools(product) and hands each call to engine.call(). Both
 * paths run the same engine, so every app gets the same five tools:
 * support_ask, support_open_ticket, support_ticket_status,
 * support_reply_to_ticket and support_set_ticket_status.
 */

export interface SupportAccount { id: string; name?: string | null; email?: string | null; [key: string]: unknown }
export interface SupportRule<A extends SupportAccount = SupportAccount> {
  match: RegExp | string[];
  /** A fixed answer, or one shaped to the caller's account. */
  answer: string | ((account: A) => string);
  nextTool?: string;
}
export interface SupportClient { userAgent?: string | null; catalogue?: string; [key: string]: unknown }
export interface RecentCall { tool: string; at: string; ms: number; ok: boolean; error?: string }

export interface SupportEngineOptions<A extends SupportAccount = SupportAccount> {
  /** Workspace service key (chs_…), canhelpto.com → Settings → Service key. */
  apiKey: string;
  /** Your product's name, as users know it. */
  product: string;
  /** Answers support_ask gives without a ticket. Matched on words or a pattern; never a model call. */
  rules?: SupportRule<A>[];
  /** Tags added to every ticket next to "mcp" and the category. */
  tags?: string[];
  /** The ticket's page. Default mcp://<product slug>. */
  page?: string;
  /** Calls kept per user for the ticket's context. Default 12. */
  keep?: number;
  /** Default https://canhelpto.com */
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface SupportOptions<A extends SupportAccount = SupportAccount> extends SupportEngineOptions<A> {
  /** Who is calling: from your auth (extra.authInfo), your session, or your own lookup. */
  user: (extra: unknown) => A | null | undefined | Promise<A | null | undefined>;
  /** What the caller is running (client name, your catalogue version). */
  client?: (extra: unknown) => SupportClient | undefined;
}

export const SUPPORT_TOOL_NAMES = ["support_ask", "support_open_ticket", "support_ticket_status", "support_reply_to_ticket", "support_set_ticket_status"] as const;
export type SupportToolName = (typeof SUPPORT_TOOL_NAMES)[number];
export const isSupportTool = (name: string): name is SupportToolName => (SUPPORT_TOOL_NAMES as readonly string[]).includes(name);
export const SUPPORT_READ_ONLY: ReadonlySet<SupportToolName> = new Set(["support_ask", "support_ticket_status"]);

// Typed loosely on purpose: zod is a peer dependency (v3 or v4, the app's own
// instance), and its types differ between majors.
export const supportInputShapes: Record<SupportToolName, Record<string, any>> = {
  support_ask: { question: z.string().min(2).max(2000).describe("The problem or question, in plain words (include the error text if a tool failed)") },
  support_open_ticket: {
    subject: z.string().min(3).max(160).describe("One line the team reads in their inbox"),
    message: z.string().min(3).max(4000).describe("What the user wants, in their words, plus what was tried. The account and the last tool calls are attached; do not repeat them."),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
    category: z.enum(["bug", "question", "billing", "account", "feature"]).default("question"),
  },
  support_ticket_status: { ticketId: z.string().max(64).optional().describe("The id support_open_ticket returned. Omit for the account's recent tickets.") },
  support_reply_to_ticket: {
    ticketId: z.string().min(1).max(64).describe("The id support_open_ticket or support_ticket_status returned"),
    message: z.string().min(1).max(4000).describe("The user's answer to the team, or the details they want to add, in their words"),
  },
  support_set_ticket_status: {
    ticketId: z.string().min(1).max(64),
    status: z.enum(["OPEN", "CLOSED"]).describe("CLOSED when the problem is solved; OPEN when it is back"),
  },
};

export interface SupportToolInfo { name: SupportToolName; title: string; description: string; inputSchema: Record<string, any>; readOnly: boolean }

export function supportTools(product: string): SupportToolInfo[] {
  const t: Record<SupportToolName, [string, string]> = {
    support_ask: [`Ask ${product} support`, `Help with ${product} itself (a tool that failed, limits, account, how-to). Answers from what the ${product} team wrote and lists the account's recent errors; if it has no answer it says so and points to support_open_ticket. Call it before support_open_ticket.`],
    support_open_ticket: [`Open a ticket with ${product}`, `Open a support ticket with the ${product} team. The account, the client and the last tool calls (with their errors) are attached, so do not paste them. Confirm the subject and message with the user first. The answer comes back by email and through support_ticket_status.`],
    support_ticket_status: [`${product} ticket status`, `Status and the team's replies on your ${product} support tickets. Without a ticketId, lists your recent tickets.`],
    support_reply_to_ticket: [`Reply on a ${product} ticket`, `Add the user's message to one of their own ${product} support tickets: an answer to the team's question, or more details. A reply on a resolved or closed ticket reopens it. Confirm the text with the user first.`],
    support_set_ticket_status: [`Close or reopen a ${product} ticket`, `Close one of the user's own ${product} support tickets when the problem is solved (CLOSED), or reopen it when it is back (OPEN). Confirm with the user first.`],
  };
  return SUPPORT_TOOL_NAMES.map((name) => ({ name, title: t[name][0], description: t[name][1], inputSchema: supportInputShapes[name], readOnly: SUPPORT_READ_ONLY.has(name) }));
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "server";

export function answerFromRules<A extends SupportAccount>(question: string, rules: SupportRule<A>[] = []): SupportRule<A> | null {
  const q = question.toLowerCase();
  for (const r of rules) {
    if (r.match instanceof RegExp ? r.match.test(question) : r.match.some((w) => q.includes(w.toLowerCase()))) return r;
  }
  return null;
}

export function renderContext(product: string, ctx: { account: Record<string, unknown>; client: Record<string, unknown>; recentCalls: RecentCall[] }): string {
  const who = [ctx.account.fullName, ctx.account.email, ctx.account.userId].filter(Boolean).join(" · ");
  const client = [ctx.client.userAgent, ctx.client.catalogue && `catalogue ${ctx.client.catalogue}`].filter(Boolean).join(" · ");
  const lines = [`- Connector context (attached by ${product}'s MCP support) -`, `Account: ${who || "unknown"}`];
  if (client) lines.push(`Client: ${client}`);
  if (ctx.recentCalls.length) {
    lines.push("Last calls (newest first):");
    for (const c of ctx.recentCalls) lines.push(`- ${c.at.slice(11, 19)} ${c.tool} · ${c.ms} ms · ${c.ok ? "ok" : c.error || "error"}`);
  }
  return lines.join("\n");
}

export interface SupportResult { text: string; isError: boolean }
const ok = (text: string): SupportResult => ({ text, isError: false });
const fail = (text: string): SupportResult => ({ text, isError: true });

export interface SupportEngine<A extends SupportAccount = SupportAccount> {
  /** Runs one support tool: validates the raw arguments, then calls canhelpto. A missing account is told to sign in. */
  call(name: SupportToolName, args: unknown, account: A | null | undefined, client?: SupportClient): Promise<SupportResult>;
  /** Records a call of one of your own tools for the ticket's context. Support tools are not recorded. */
  record(userId: string, call: RecentCall): void;
  recentCalls(userId: string): RecentCall[];
  /** The line every error of your own tools should carry. */
  hint: string;
}

export function createSupport<A extends SupportAccount>(opts: SupportEngineOptions<A>): SupportEngine<A> {
  const base = (opts.baseUrl ?? "https://canhelpto.com").replace(/\/$/, "");
  const doFetch = opts.fetch ?? fetch;
  const keep = opts.keep ?? 12;
  const recent = new Map<string, RecentCall[]>();
  const product = opts.product;
  const parsers = Object.fromEntries(SUPPORT_TOOL_NAMES.map((n) => [n, z.object(supportInputShapes[n])])) as unknown as Record<SupportToolName, { parse: (v: unknown) => any }>;

  const record = (userId: string, c: RecentCall) => {
    if (isSupportTool(c.tool)) return;
    const list = recent.get(userId) ?? [];
    list.unshift(c);
    list.length = Math.min(list.length, keep);
    recent.set(userId, list);
  };

  // Customer-mode calls: never X-Service-Mode, so internal notes stay out and a
  // reply counts as the customer's (it reopens a closed ticket, notifies the team).
  // With the service key canhelpto needs no email code from the customer.
  const headers = { "X-API-Key": opts.apiKey, "User-Agent": "canhelpto-mcp-support/0.3" };
  const mine = (t: any, u: A) => {
    const byId = t?.metadata?.mcp?.account?.userId;
    if (byId) return byId === u.id;
    const email = String(t?.customerEmail ?? "").trim().toLowerCase();
    return !!email && !!u.email && email === u.email.trim().toLowerCase();
  };
  const ownTicket = async (ticketId: string, u: A): Promise<any | null> => {
    const r = await doFetch(`${base}/api/v1/tickets/${encodeURIComponent(ticketId)}`, { headers });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`The support desk answered ${r.status}. Try again in a minute.`);
    const raw: any = await r.json();
    const t = raw?.ticket ?? raw;
    return mine(t, u) ? t : null;
  };
  const notFound = (id: string) => fail(`Ticket ${id} was not found on your account.`);
  const withoutContext = (m: string) => String(m ?? "").split(/\n\n-{1,3} Connector context/)[0];

  const handlers: Record<SupportToolName, (input: any, u: A, client: SupportClient) => Promise<SupportResult>> = {
    async support_ask({ question }, u) {
      const rule = answerFromRules(question, opts.rules);
      const errors = (recent.get(u.id) ?? []).filter((c) => !c.ok);
      const lines = [rule ? (typeof rule.answer === "function" ? rule.answer(u) : rule.answer) : `No saved answer for that in ${product}'s rules.`];
      if (rule?.nextTool) lines.push(`Next: call ${rule.nextTool}.`);
      if (errors.length) lines.push("Recent errors on this account:", ...errors.map((c) => `- ${c.at.slice(11, 19)} ${c.tool}: ${c.error ?? "error"}`));
      lines.push(rule
        ? `If this does not settle it, support_open_ticket puts it to the ${product} team with the recent calls attached.`
        : `Call support_open_ticket: it reaches the ${product} team with your recent calls attached, and support_ticket_status brings the answer back here.`);
      return ok(lines.join("\n"));
    },

    async support_open_ticket(input, u, client) {
      const { id, name, email, ...rest } = u;
      const ctx = { account: { userId: id, fullName: name ?? null, email: email ?? null, ...rest }, client, recentCalls: recent.get(id) ?? [] };
      const res = await doFetch(`${base}/api/v1/tickets`, {
        method: "POST",
        headers: { ...headers, "X-Service-Mode": "true", "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: input.subject.trim(),
          message: `${input.message.trim()}\n\n${renderContext(product, ctx)}`,
          priority: input.priority,
          category: input.category,
          customerName: name ?? undefined,
          customerEmail: email ?? undefined,
          tags: ["mcp", ...(opts.tags ?? []), input.category],
          page: opts.page ?? `mcp://${slug(product)}`,
          metadata: { mcp: ctx },
        }),
      });
      if (!res.ok) return fail(`The ticket could not be opened (HTTP ${res.status}). Try again in a minute.`);
      const { ticket } = (await res.json()) as { ticket: { id: string } };
      return ok(`Ticket ${ticket.id} is with the ${product} team. Ask for news with support_ticket_status; the answer also comes by email${email ? ` to ${email}` : ""}.`);
    },

    async support_ticket_status({ ticketId }, u) {
      const show = (t: any) => `${t.id} · ${t.status} · ${t.summary ?? withoutContext(t.message).slice(0, 80)}`;
      if (ticketId) {
        const t = await ownTicket(ticketId, u);
        if (!t) return notFound(ticketId);
        const replies = (t.replies ?? []).filter((x: any) => !x.isInternal).map((x: any) => `- ${x.userId ? `${product} team` : x.isAI ? "automatic" : "you"}: ${x.message}`);
        return ok([show(t), replies.length ? `Replies:\n${replies.join("\n")}` : "No reply from the team yet."].join("\n"));
      }
      if (!u.email) return fail("Give a ticketId: your account has no email to list tickets by.");
      const r = await doFetch(`${base}/api/v1/tickets?email=${encodeURIComponent(u.email)}&limit=10`, { headers });
      if (!r.ok) return fail(`The support desk answered ${r.status}. Try again in a minute.`);
      const own = (((await r.json()) as { tickets?: any[] }).tickets ?? []).filter((t) => mine(t, u));
      return ok(own.length ? own.map(show).join("\n") : "No support tickets on your account.");
    },

    async support_reply_to_ticket({ ticketId, message }, u) {
      const t = await ownTicket(ticketId, u);
      if (!t) return notFound(ticketId);
      // canhelpto checks the customer email against the ticket on this route.
      if (!t.customerEmail) return fail(`Ticket ${ticketId} has no email on it, so it cannot be answered from here; open a new ticket instead.`);
      const res = await doFetch(`${base}/api/v1/tickets/${encodeURIComponent(ticketId)}/replies`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ email: t.customerEmail, message: message.trim() }),
      });
      if (!res.ok) return fail(`The reply could not be added (HTTP ${res.status}). Try again in a minute.`);
      const reopened = t.status === "RESOLVED" || t.status === "CLOSED";
      return ok(`Added to ticket ${ticketId}; the ${product} team is notified.${reopened ? " The ticket is open again." : ""}`);
    },

    async support_set_ticket_status({ ticketId, status }, u) {
      const t = await ownTicket(ticketId, u);
      if (!t) return notFound(ticketId);
      if (!t.customerEmail) return fail(`Ticket ${ticketId} has no email on it, so it cannot be changed from here.`);
      const res = await doFetch(`${base}/api/v1/tickets/${encodeURIComponent(ticketId)}/status`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ email: t.customerEmail, status }),
      });
      if (!res.ok) return fail(`The ticket could not be changed (HTTP ${res.status}). Try again in a minute.`);
      return ok(status === "CLOSED" ? `Ticket ${ticketId} is closed.` : `Ticket ${ticketId} is open again; the ${product} team sees it in the inbox.`);
    },
  };

  return {
    async call(name, args, account, client = {}) {
      if (!account) return fail("Sign in first: support tickets are tied to your account.");
      let input: unknown;
      try {
        input = parsers[name].parse(args ?? {});
      } catch (e) {
        return fail(`Invalid input for ${name}: ${(e as Error).message.slice(0, 300)}`);
      }
      try {
        return await handlers[name](input, account, client);
      } catch (e) {
        return fail((e as Error).message.slice(0, 300));
      }
    },
    record,
    recentCalls: (userId) => [...(recent.get(userId) ?? [])],
    hint: `If this keeps failing, call support_ask; support_open_ticket puts it to the ${product} team with this error attached.`,
  };
}

function errorText(result: unknown): string | undefined {
  const content = (result as { content?: Array<{ type?: string; text?: string }> })?.content;
  return content?.filter((c) => c.type === "text").map((c) => c.text).join(" ").slice(0, 300) || undefined;
}

export function withSupport<A extends SupportAccount>(server: McpServer, opts: SupportOptions<A>) {
  const engine = createSupport(opts);
  const who = async (extra: unknown) => (await opts.user(extra)) ?? null;

  // Every tool registered from now on is timed, recorded per user, and its errors
  // carry the support hint. The support tools themselves are not recorded.
  const original = server.registerTool.bind(server) as (...a: unknown[]) => unknown;
  (server as unknown as { registerTool: (...a: unknown[]) => unknown }).registerTool = (name: unknown, config: unknown, cb: unknown) => {
    const handler = cb as (...a: unknown[]) => Promise<unknown>;
    if (typeof name === "string" && isSupportTool(name)) return original(name, config, cb);
    return original(name, config, async (...args: unknown[]) => {
      const extra = args[args.length - 1];
      const started = Date.now();
      let ok = true;
      let error: string | undefined;
      try {
        const result = await handler(...args);
        if ((result as { isError?: boolean })?.isError) {
          ok = false;
          error = errorText(result);
          const r = result as { content?: Array<{ type: string; text?: string }> };
          return { ...r, content: [...(r.content ?? []), { type: "text", text: engine.hint }] };
        }
        return result;
      } catch (e) {
        ok = false;
        error = (e as Error)?.message?.slice(0, 300);
        throw e;
      } finally {
        const u = await Promise.resolve(who(extra)).catch(() => null);
        if (u) engine.record(u.id, { tool: name as string, at: new Date().toISOString(), ms: Date.now() - started, ok, ...(error ? { error } : {}) });
      }
    });
  };

  for (const tool of supportTools(opts.product)) {
    original(tool.name, {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: { title: tool.title, readOnlyHint: tool.readOnly, destructiveHint: !tool.readOnly },
    }, async (args: unknown, extra: unknown) => {
      const r = await engine.call(tool.name, args, await who(extra), opts.client?.(extra) ?? {});
      return { content: [{ type: "text" as const, text: r.text }], ...(r.isError ? { isError: true } : {}) };
    });
  }

  return { recentCalls: engine.recentCalls };
}
