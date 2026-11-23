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
 * support_reply_to_ticket and support_set_ticket_status. A host that passes
 * canSeeAllTickets also gets support_list_tickets for its team: those accounts
 * list, read, answer and reopen every ticket of the workspace.
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
  /** @deprecated canhelpto keeps only its standard tags since 2026-11-23; Source MCP marks connector tickets. Ignored. */
  tags?: string[];
  /** The ticket's page. Default mcp://<product slug>. */
  page?: string;
  /** Calls kept per user for the ticket's context. Default 12. */
  keep?: number;
  /**
   * True for an account of your own team (an admin): it lists every ticket of the
   * workspace (support_list_tickets) and reads, answers and reopens any of them.
   * Its reply on someone else's ticket is written as a team reply under its own
   * name, never as the ticket's customer. Default: nobody, each user sees only
   * their own tickets.
   */
  canSeeAllTickets?: (account: A) => boolean;
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

/** The tools every user gets. */
export const SUPPORT_TOOL_NAMES = ["support_ask", "support_open_ticket", "support_ticket_status", "support_reply_to_ticket", "support_set_ticket_status"] as const;
/** The tools only accounts with canSeeAllTickets get (register them for those accounts only). */
export const SUPPORT_TEAM_TOOL_NAMES = ["support_list_tickets"] as const;
export type SupportToolName = (typeof SUPPORT_TOOL_NAMES)[number] | (typeof SUPPORT_TEAM_TOOL_NAMES)[number];
const ALL_TOOL_NAMES: readonly SupportToolName[] = [...SUPPORT_TOOL_NAMES, ...SUPPORT_TEAM_TOOL_NAMES];
export const isSupportTool = (name: string): name is SupportToolName => (ALL_TOOL_NAMES as readonly string[]).includes(name);
export const SUPPORT_READ_ONLY: ReadonlySet<SupportToolName> = new Set(["support_ask", "support_ticket_status", "support_list_tickets"]);

// Typed loosely on purpose: zod is a peer dependency (v3 or v4, the app's own
// instance), and its types differ between majors.
export const supportInputShapes: Record<SupportToolName, Record<string, any>> = {
  support_ask: { question: z.string().min(2).max(2000).describe("The problem or question, in plain words (include the error text if a tool failed)") },
  support_open_ticket: {
    subject: z.string().min(3).max(160).describe("One line the team reads in their inbox"),
    message: z.string().min(3).max(4000).describe("What the user wants, in their words, plus what was tried. The account and the last tool calls are attached; do not repeat them."),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
    type: z.enum(["issue", "feature"]).default("issue").describe("feature = asks for something the product does not do yet; issue = everything else (a problem, a question, billing, account)"),
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
  support_list_tickets: {
    status: z.enum(["active", "OPEN", "IN_PROGRESS", "RESOLVED", "all"]).default("active").describe("active = OPEN and IN_PROGRESS (default); all = every status"),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
    limit: z.number().int().min(1).max(50).default(20),
  },
};

export interface SupportToolInfo { name: SupportToolName; title: string; description: string; inputSchema: Record<string, any>; readOnly: boolean }

/** The five tools every user gets; with { team: true } also the team tools (for accounts with canSeeAllTickets). */
export function supportTools(product: string, opts: { team?: boolean } = {}): SupportToolInfo[] {
  const team = opts.team ? ` As a member of the ${product} team you can also do this on any ticket of the team (support_list_tickets lists them); there the message is posted as a team reply under your name.` : "";
  const t: Record<SupportToolName, [string, string]> = {
    support_ask: [`Ask ${product} support`, `Help with ${product} itself (a tool that failed, limits, account, how-to). Answers from what the ${product} team wrote and lists the account's recent errors; if it has no answer it says so and points to support_open_ticket. Call it before support_open_ticket.`],
    support_open_ticket: [`Open a ticket with ${product}`, `Open a support ticket with the ${product} team. The account, the client and the last tool calls (with their errors) are attached, so do not paste them. Confirm the subject and message with the user first. The answer comes back by email and through support_ticket_status.`],
    support_ticket_status: [`${product} ticket status`, `Status and the team's replies on your ${product} support tickets. Without a ticketId, lists your recent tickets.${opts.team ? ` As a member of the ${product} team you can read any ticket of the team by its id (internal notes are not shown).` : ""}`],
    support_reply_to_ticket: [`Reply on a ${product} ticket`, `Add the user's message to one of their own ${product} support tickets: an answer to the team's question, or more details. A reply on a resolved or closed ticket reopens it.${team} Confirm the text with the user first.`],
    support_set_ticket_status: [`Close or reopen a ${product} ticket`, `Close one of the user's own ${product} support tickets when the problem is solved (CLOSED), or reopen it when it is back (OPEN).${team} Confirm with the user first.`],
    support_list_tickets: [`List the ${product} team's tickets`, `For the ${product} team: every support ticket of the workspace, not only your own, newest first, with status, priority, who it is from and the number of replies. Filter by status (default: active, meaning OPEN and IN_PROGRESS) and priority. Read one with support_ticket_status; answer it with support_reply_to_ticket.`],
  };
  const names: readonly SupportToolName[] = opts.team ? ALL_TOOL_NAMES : SUPPORT_TOOL_NAMES;
  return names.map((name) => ({ name, title: t[name][0], description: t[name][1], inputSchema: supportInputShapes[name], readOnly: SUPPORT_READ_ONLY.has(name) }));
}

/** The first line of a team member's reply on someone else's ticket: the API has no author field, so the author is in the text. */
export const teamAuthorLine = (product: string, a: { name?: string | null; email?: string | null }) =>
  `From ${[a.name?.trim() || null, a.email ? `(${a.email})` : null].filter(Boolean).join(" ") || "a team member"}, ${product} team:`;
const AUTHOR_LINE = /^From (.+?), [^\n]+ team:\n+/;

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
  // Looked up on each call, so a fetch installed after the engine (a polyfill, a test stub) is used.
  const doFetch: typeof fetch = (input, init) => (opts.fetch ?? fetch)(input, init);
  const keep = opts.keep ?? 12;
  const recent = new Map<string, RecentCall[]>();
  const product = opts.product;
  const parsers = Object.fromEntries(ALL_TOOL_NAMES.map((n) => [n, z.object(supportInputShapes[n])])) as unknown as Record<SupportToolName, { parse: (v: unknown) => any }>;

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
  const headers = { "X-API-Key": opts.apiKey, "User-Agent": "canhelpto-mcp-support/0.4" };
  const mine = (t: any, u: A) => {
    const byId = t?.metadata?.mcp?.account?.userId;
    if (byId) return byId === u.id;
    const email = String(t?.customerEmail ?? "").trim().toLowerCase();
    return !!email && !!u.email && email === u.email.trim().toLowerCase();
  };
  const team = (u: A) => opts.canSeeAllTickets?.(u) === true;
  // Read in customer mode either way, so internal notes never reach the chat.
  // `own` tells which path a write takes: the customer's, or a team reply.
  const ticketFor = async (ticketId: string, u: A): Promise<{ t: any; own: boolean } | null> => {
    const r = await doFetch(`${base}/api/v1/tickets/${encodeURIComponent(ticketId)}`, { headers });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`The support desk answered ${r.status}. Try again in a minute.`);
    const raw: any = await r.json();
    const t = raw?.ticket ?? raw;
    if (mine(t, u)) return { t, own: true };
    return team(u) ? { t, own: false } : null;
  };
  const notFound = (id: string, u: A) => fail(team(u) ? `Ticket ${id} was not found in the ${product} workspace.` : `Ticket ${id} was not found on your account.`);
  // Team-mode writes: service mode, so nothing is written as the customer.
  const svc = { ...headers, "X-Service-Mode": "true", "Content-Type": "application/json" };
  const setStatusAsTeam = (ticketId: string, status: "OPEN" | "CLOSED") =>
    doFetch(`${base}/api/v1/tickets/${encodeURIComponent(ticketId)}`, { method: "PATCH", headers: svc, body: JSON.stringify({ status }) });
  const customerOf = (t: any) => [t.customerName, t.customerEmail && `<${t.customerEmail}>`].filter(Boolean).join(" ") || "unknown";
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
          type: input.type,
          customerName: name ?? undefined,
          customerEmail: email ?? undefined,
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
        const found = await ticketFor(ticketId, u);
        if (!found) return notFound(ticketId, u);
        const { t, own } = found;
        const who = (x: any) => {
          // canhelpto names every team reply since 2026-11-23 (a person, Marco, an API caller).
          if (x.author) return `${x.author} (${product} team)`;
          if (x.userId) return `${product} team`;
          if (x.isAI) return "automatic";
          const author = String(x.message ?? "").match(AUTHOR_LINE)?.[1];
          if (author) return author;
          return own ? "you" : `customer ${customerOf(t)}`;
        };
        const replies = (t.replies ?? []).filter((x: any) => !x.isInternal).map((x: any) => `- ${who(x)}: ${String(x.message ?? "").replace(AUTHOR_LINE, "")}`);
        const head = own ? [show(t)] : [show(t), `From: ${customerOf(t)} · priority ${t.priority ?? "?"}`, `Message: ${withoutContext(t.message).slice(0, 1500)}`];
        return ok([...head, replies.length ? `Replies:\n${replies.join("\n")}` : "No reply from the team yet."].join("\n"));
      }
      if (!u.email) return fail("Give a ticketId: your account has no email to list tickets by.");
      const r = await doFetch(`${base}/api/v1/tickets?email=${encodeURIComponent(u.email)}&limit=10`, { headers });
      if (!r.ok) return fail(`The support desk answered ${r.status}. Try again in a minute.`);
      const own = (((await r.json()) as { tickets?: any[] }).tickets ?? []).filter((t) => mine(t, u));
      return ok(own.length ? own.map(show).join("\n") : "No support tickets on your account.");
    },

    async support_reply_to_ticket({ ticketId, message }, u) {
      const found = await ticketFor(ticketId, u);
      if (!found) return notFound(ticketId, u);
      const { t, own } = found;
      const reopened = t.status === "RESOLVED" || t.status === "CLOSED";
      if (!own) {
        const res = await doFetch(`${base}/api/v1/tickets/${encodeURIComponent(ticketId)}/replies`, {
          method: "POST",
          headers: svc,
          body: JSON.stringify({ message: `${teamAuthorLine(product, u)}\n\n${message.trim()}`, isInternal: false }),
        });
        if (!res.ok) return fail(`The reply could not be added (HTTP ${res.status}). Try again in a minute.`);
        if (reopened) {
          const r2 = await setStatusAsTeam(ticketId, "OPEN");
          if (!r2.ok) return ok(`Added to ticket ${ticketId} as ${u.name || u.email || "you"}, but it could not be reopened (HTTP ${r2.status}).`);
        }
        return ok(`Added to ticket ${ticketId} as a team reply from ${u.name || u.email || "you"}; it shows on the ticket in the inbox and to its customer. No email is sent.${reopened ? " The ticket is open again." : ""}`);
      }
      // canhelpto checks the customer email against the ticket on this route.
      if (!t.customerEmail) return fail(`Ticket ${ticketId} has no email on it, so it cannot be answered from here; open a new ticket instead.`);
      const res = await doFetch(`${base}/api/v1/tickets/${encodeURIComponent(ticketId)}/replies`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ email: t.customerEmail, message: message.trim() }),
      });
      if (!res.ok) return fail(`The reply could not be added (HTTP ${res.status}). Try again in a minute.`);
      return ok(`Added to ticket ${ticketId}; the ${product} team is notified.${reopened ? " The ticket is open again." : ""}`);
    },

    async support_set_ticket_status({ ticketId, status }, u) {
      const found = await ticketFor(ticketId, u);
      if (!found) return notFound(ticketId, u);
      const { t, own } = found;
      if (!own) {
        const res = await setStatusAsTeam(ticketId, status);
        if (!res.ok) return fail(`The ticket could not be changed (HTTP ${res.status}). Try again in a minute.`);
        return ok(status === "CLOSED" ? `Ticket ${ticketId} is closed.` : `Ticket ${ticketId} is open again in the ${product} inbox.`);
      }
      if (!t.customerEmail) return fail(`Ticket ${ticketId} has no email on it, so it cannot be changed from here.`);
      const res = await doFetch(`${base}/api/v1/tickets/${encodeURIComponent(ticketId)}/status`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ email: t.customerEmail, status }),
      });
      if (!res.ok) return fail(`The ticket could not be changed (HTTP ${res.status}). Try again in a minute.`);
      return ok(status === "CLOSED" ? `Ticket ${ticketId} is closed.` : `Ticket ${ticketId} is open again; the ${product} team sees it in the inbox.`);
    },

    async support_list_tickets({ status, priority, limit }, u) {
      if (!team(u)) return fail(`Listing every ticket is for the ${product} team. support_ticket_status lists your own tickets.`);
      const statuses: (string | null)[] = status === "active" ? ["OPEN", "IN_PROGRESS"] : status === "all" ? [null] : [status];
      const all: any[] = [];
      for (const s of statuses) {
        const q = new URLSearchParams({ limit: String(limit) });
        if (s) q.set("status", s);
        if (priority) q.set("priority", priority);
        // Service mode is the only way to list the workspace; replies are reduced to a
        // count of the public ones, so internal notes never reach the chat.
        const r = await doFetch(`${base}/api/v1/tickets?${q}`, { headers: { ...headers, "X-Service-Mode": "true" } });
        if (!r.ok) return fail(`The support desk answered ${r.status}. Try again in a minute.`);
        all.push(...(((await r.json()) as { tickets?: any[] }).tickets ?? []));
      }
      const rows = all.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit);
      if (!rows.length) return ok(`No ${status === "all" ? "" : status === "active" ? "open " : `${status} `}tickets in the ${product} workspace${priority ? ` at priority ${priority}` : ""}.`);
      return ok(rows.map((t) => {
        const replies = (t.replies ?? []).filter((x: any) => !x.isInternal).length;
        return `${t.id} · ${t.status} · ${t.priority} · ${t.summary ?? withoutContext(t.message).slice(0, 80)} · from ${customerOf(t)} · ${String(t.createdAt ?? "").slice(0, 10)} · ${replies} repl${replies === 1 ? "y" : "ies"}`;
      }).join("\n"));
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

  // withSupport registers one catalogue for every caller, so the team tool is there
  // only when the host passes canSeeAllTickets; the engine still refuses others.
  for (const tool of supportTools(opts.product, { team: !!opts.canSeeAllTickets })) {
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
