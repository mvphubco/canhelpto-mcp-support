import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Customer support inside your MCP server (canhelpto.com).
 *
 *   const server = new McpServer({ name: "acme", version: "1.0.0" });
 *   withSupport(server, { apiKey: process.env.CANHELPTO_API_KEY!, product: "Acme", user: (extra) => myUser(extra) });
 *   // then register your own tools as usual
 *
 * Adds support_ask, support_open_ticket and support_ticket_status, records the
 * last calls of every tool registered after it, and appends a support hint to
 * every tool error, so the agent knows where to turn when your tool fails.
 */

export interface SupportAccount { id: string; name?: string; email?: string; [key: string]: unknown }
export interface SupportRule { match: RegExp | string[]; answer: string; nextTool?: string }
export interface SupportClient { userAgent?: string; catalogue?: string; [key: string]: unknown }
export interface RecentCall { tool: string; at: string; ms: number; ok: boolean; error?: string }

export interface SupportOptions {
  /** Workspace service key (chs_…), canhelpto.com → Settings → Service key. */
  apiKey: string;
  /** Your product's name, as users know it. */
  product: string;
  /** Who is calling: from your auth (extra.authInfo), your session, or your own lookup. */
  user: (extra: unknown) => SupportAccount | null | undefined | Promise<SupportAccount | null | undefined>;
  /** Answers support_ask gives without a ticket. Matched on words or a pattern; never a model call. */
  rules?: SupportRule[];
  /** What the caller is running (client name, your catalogue version). */
  client?: (extra: unknown) => SupportClient | undefined;
  /** Calls kept per user for the ticket's context. Default 12. */
  keep?: number;
  /** Default https://canhelpto.com */
  baseUrl?: string;
  fetch?: typeof fetch;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "server";

export function answerFromRules(question: string, rules: SupportRule[] = []): SupportRule | null {
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

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) });

function errorText(result: unknown): string | undefined {
  const content = (result as { content?: Array<{ type?: string; text?: string }> })?.content;
  return content?.filter((c) => c.type === "text").map((c) => c.text).join(" ").slice(0, 300) || undefined;
}

export function withSupport(server: McpServer, opts: SupportOptions) {
  const base = (opts.baseUrl ?? "https://canhelpto.com").replace(/\/$/, "");
  const doFetch = opts.fetch ?? fetch;
  const keep = opts.keep ?? 12;
  const recent = new Map<string, RecentCall[]>();
  const hint = `\n\nIf this keeps failing, call support_ask; support_open_ticket puts it to the ${opts.product} team with this error attached.`;

  const record = (userId: string, c: RecentCall) => {
    const list = recent.get(userId) ?? [];
    list.unshift(c);
    list.length = Math.min(list.length, keep);
    recent.set(userId, list);
  };
  const who = async (extra: unknown) => (await opts.user(extra)) ?? null;

  // Every tool registered from now on is timed, recorded per user, and its errors
  // carry the support hint. The support tools themselves are not recorded.
  const original = server.registerTool.bind(server) as (...a: unknown[]) => unknown;
  (server as unknown as { registerTool: (...a: unknown[]) => unknown }).registerTool = (name: unknown, config: unknown, cb: unknown) => {
    const handler = cb as (...a: unknown[]) => Promise<unknown>;
    if (typeof name === "string" && name.startsWith("support_")) return original(name, config, cb);
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
          return { ...r, content: [...(r.content ?? []), { type: "text", text: hint.trim() }] };
        }
        return result;
      } catch (e) {
        ok = false;
        error = (e as Error)?.message?.slice(0, 300);
        throw e;
      } finally {
        const u = await Promise.resolve(who(extra)).catch(() => null);
        if (u) record(u.id, { tool: name as string, at: new Date().toISOString(), ms: Date.now() - started, ok, ...(error ? { error } : {}) });
      }
    });
  };

  original("support_ask", {
    title: `Ask ${opts.product} support`,
    description: `Help with ${opts.product} itself (errors, limits, account, how-to). Answers from what the ${opts.product} team wrote; if it has no answer it says so and points to support_open_ticket.`,
    inputSchema: { question: z.string().min(2) },
    annotations: { readOnlyHint: true },
  }, async ({ question }: { question: string }) => {
    const rule = answerFromRules(question, opts.rules);
    if (rule) return text(rule.nextTool ? `${rule.answer}\nNext: call ${rule.nextTool}.` : rule.answer);
    return text(`No saved answer for that. Call support_open_ticket: it reaches the ${opts.product} team with your recent calls attached, and support_ticket_status brings the answer back here.`);
  });

  original("support_open_ticket", {
    title: `Open a ticket with ${opts.product}`,
    description: `Open a support ticket with the ${opts.product} team. The account, the client and the last tool calls (with their errors) are attached, so do not paste them. Confirm the subject with the user first.`,
    inputSchema: {
      subject: z.string().min(3).max(160),
      message: z.string().min(3).max(4000),
      priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
      category: z.enum(["bug", "question", "billing", "account", "feature"]).default("question"),
    },
  }, async (input: { subject: string; message: string; priority: string; category: string }, extra: unknown) => {
    const u = await who(extra);
    if (!u) return text("Sign in first: support tickets are tied to your account.", true);
    const { id, name, email, ...rest } = u;
    const account = { userId: id, fullName: name ?? null, email: email ?? null, ...rest };
    const client = opts.client?.(extra) ?? {};
    const ctx = { account, client, recentCalls: recent.get(id) ?? [] };
    const res = await doFetch(`${base}/api/v1/tickets`, {
      method: "POST",
      headers: { "X-API-Key": opts.apiKey, "X-Service-Mode": "true", "Content-Type": "application/json", "User-Agent": "canhelpto-mcp-support/0.1" },
      body: JSON.stringify({
        summary: input.subject,
        message: `${input.message}\n\n${renderContext(opts.product, ctx)}`,
        priority: input.priority,
        category: input.category,
        customerName: name,
        customerEmail: email,
        tags: ["mcp", input.category],
        page: `mcp://${slug(opts.product)}`,
        metadata: { mcp: ctx },
      }),
    });
    if (!res.ok) return text(`The ticket could not be opened (HTTP ${res.status}). Try again in a minute.`, true);
    const { ticket } = (await res.json()) as { ticket: { id: string } };
    return text(`Ticket ${ticket.id} is with the ${opts.product} team. Ask for news with support_ticket_status; the answer also comes by email${email ? ` to ${email}` : ""}.`);
  });

  original("support_ticket_status", {
    title: `${opts.product} ticket status`,
    description: `Status and the team's replies on your ${opts.product} support tickets. Without a ticketId, lists your recent tickets.`,
    inputSchema: { ticketId: z.string().optional() },
    annotations: { readOnlyHint: true },
  }, async ({ ticketId }: { ticketId?: string }, extra: unknown) => {
    const u = await who(extra);
    if (!u) return text("Sign in first: tickets are tied to your account.", true);
    // Reads never send X-Service-Mode, so the team's internal notes stay out.
    const headers = { "X-API-Key": opts.apiKey, "User-Agent": "canhelpto-mcp-support/0.1" };
    const mine = (t: any) => t?.metadata?.mcp?.account?.userId === u.id || (!!u.email && t?.customerEmail === u.email);
    if (ticketId) {
      const r = await doFetch(`${base}/api/v1/tickets/${encodeURIComponent(ticketId)}`, { headers });
      const t: any = r.ok ? await r.json() : null;
      if (!t || !mine(t)) return text(`Ticket ${ticketId} was not found on your account.`, true);
      const replies = (t.replies ?? []).filter((x: any) => !x.isInternal && x.userId).map((x: any) => `- ${x.message}`);
      return text([`${t.id} · ${t.status} · ${t.summary ?? ""}`, replies.length ? `Replies from the team:\n${replies.join("\n")}` : "No reply from the team yet."].join("\n"));
    }
    if (!u.email) return text("Give a ticketId: your account has no email to list tickets by.", true);
    const r = await doFetch(`${base}/api/v1/tickets?email=${encodeURIComponent(u.email)}&limit=10`, { headers });
    const list: any[] = r.ok ? (((await r.json()) as { tickets?: any[] }).tickets ?? []) : [];
    const own = list.filter(mine);
    return text(own.length ? own.map((t) => `${t.id} · ${t.status} · ${t.summary ?? ""}`).join("\n") : "No support tickets on your account.");
  });

  return { recentCalls: (userId: string) => [...(recent.get(userId) ?? [])] };
}
