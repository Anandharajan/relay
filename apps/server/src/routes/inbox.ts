import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { ctx } from '../ctx.ts';
import { heartbeat, listPresence, subscribe, type RelayEvent } from '../lib/events.ts';
import { body, fail, requireOrg, requireUser, type AppEnv } from '../http.ts';
import { answer } from '../engine/answer.ts';
import {
  addMessage, createDraft, decideActionRun, decideDraft, getConversation, history, learn, resolve, setStatus,
} from '../services/conversations.ts';

export const inbox = new Hono<AppEnv>();
inbox.use(requireUser, requireOrg);

const views: Record<string, string> = {
  open: `status in ('ai', 'escalated', 'human')`,
  attention: `(status = 'escalated' or exists (select 1 from ai_drafts d where d.conversation_id = c.id and d.status = 'pending'))`,
  ai: `status = 'ai'`,
  human: `status = 'human'`,
  resolved: `status = 'resolved'`,
  all: 'true',
};

inbox.get('/conversations', async (c) => {
  const org = c.get('org');
  const view = views[c.req.query('view') ?? 'open'] ?? views.open!;
  const q = c.req.query('q')?.trim();
  const params: unknown[] = [org.id];
  let search = '';
  if (q) {
    params.push(`%${q}%`);
    search = `and (c.customer_name ilike $2 or c.last_message_preview ilike $2 or exists (select 1 from messages m where m.conversation_id = c.id and m.content ilike $2))`;
  }
  const rows = await ctx.db.query(
    `select c.*, u.name as assignee_name,
            (select count(*)::int from ai_drafts d where d.conversation_id = c.id and d.status = 'pending') as pending_drafts
       from conversations c left join users u on u.id = c.assigned_to
      where c.org_id = $1 and ${view} ${search}
      order by c.last_message_at desc limit 200`,
    params,
  );
  const counts = await ctx.db.one(
    `select count(*) filter (where status in ('ai','escalated','human'))::int as open,
            count(*) filter (where status = 'escalated' or exists (select 1 from ai_drafts d where d.conversation_id = c.id and d.status = 'pending'))::int as attention,
            count(*) filter (where status = 'ai')::int as ai, count(*) filter (where status = 'human')::int as human,
            count(*) filter (where status = 'resolved')::int as resolved
       from conversations c where org_id = $1`,
    [org.id],
  );
  return c.json({ conversations: rows, counts });
});

inbox.get('/conversations/:id', async (c) => {
  const org = c.get('org');
  const conv = await getConversation(org.id, c.req.param('id'));
  if (!conv) fail(404, 'Conversation not found');
  const [messages, drafts, actionRuns, consents] = await Promise.all([
    ctx.db.query(`select m.*, u.name as author_name from messages m left join users u on u.id = m.author_id where m.conversation_id = $1 order by m.created_at`, [conv.id]),
    ctx.db.query(`select * from ai_drafts where conversation_id = $1 order by created_at`, [conv.id]),
    ctx.db.query(`select r.*, a.name as action_name, a.sensitive from action_runs r join actions a on a.id = r.action_id where r.conversation_id = $1 order by r.created_at`, [conv.id]),
    ctx.db.query(`select purpose, granted_at from consents where org_id = $1 and visitor_id = $2`, [org.id, conv.visitor_id]),
  ]);
  return c.json({ conversation: conv, messages, drafts, actionRuns, consents });
});

async function load(c: any) {
  const conv = await getConversation(c.get('org').id, c.req.param('id'));
  if (!conv) fail(404, 'Conversation not found');
  return conv;
}

/** Human reply or internal note. Notes that mention @AI ask the AI for a suggested reply draft. */
inbox.post('/conversations/:id/messages', async (c) => {
  const org = c.get('org');
  const user = c.get('user');
  const conv = await load(c);
  const b = await body(c, z.object({ content: z.string().min(1).max(5000), note: z.boolean().default(false) }));
  if (b.note) {
    const msg = await addMessage(conv, 'note', b.content, { authorId: user.id });
    if (/@(ai|relay)\b/i.test(b.content)) {
      const turns = await history(conv.id);
      const lastCustomer = [...turns].reverse().find((t) => t.role === 'customer');
      if (lastCustomer) {
        const out = await answer({ org, question: lastCustomer.content, history: turns.slice(0, -1), meta: {}, instruction: b.content.replace(/@(ai|relay)\b/gi, '').trim(), dryRun: true, skipActions: true });
        const text = out.kind === 'answer' ? out.text : (out.suggestion?.text ?? '');
        if (text) await createDraft(conv, lastCustomer.content, text, out.kind === 'answer' ? out.citations : (out.suggestion?.citations ?? []), out.confidence);
        else await addMessage(conv, 'note', "🤖 I couldn't find anything relevant in the knowledge base for this. Add a source, or reply manually and click “Teach AI”.", {});
      }
    }
    return c.json(msg);
  }
  const msg = await addMessage(conv, 'human', b.content, { authorId: user.id });
  // Replying takes over the conversation from the AI.
  if (conv.status !== 'human' && conv.status !== 'resolved') await setStatus(conv, 'human', { assigned_to: user.id });
  // Any pending drafts are superseded by a manual reply.
  await ctx.db.query(`update ai_drafts set status = 'discarded', decided_at = now() where conversation_id = $1 and status = 'pending'`, [conv.id]);
  return c.json(msg);
});

inbox.post('/conversations/:id/drafts/:draftId', async (c) => {
  const conv = await load(c);
  const b = await body(c, z.object({ decision: z.enum(['send', 'discard']), text: z.string().max(5000).optional() }));
  try {
    await decideDraft(c.get('org'), conv, c.req.param('draftId'), c.get('user').id, b.decision, b.text);
  } catch (e) {
    fail(409, (e as Error).message);
  }
  return c.json({ ok: true });
});

inbox.post('/conversations/:id/takeover', async (c) => {
  const conv = await load(c);
  await setStatus(conv, 'human', { assigned_to: c.get('user').id });
  await addMessage(conv, 'system', `${c.get('user').name} joined the conversation`);
  return c.json({ ok: true });
});

inbox.post('/conversations/:id/handback', async (c) => {
  const conv = await load(c);
  await setStatus(conv, 'ai');
  await ctx.db.query('update conversations set assigned_to = null where id = $1', [conv.id]);
  await addMessage(conv, 'system', `${c.get('user').name} handed the conversation back to AI`);
  return c.json({ ok: true });
});

inbox.post('/conversations/:id/resolve', async (c) => {
  const conv = await load(c);
  await resolve(conv, 'human');
  return c.json({ ok: true });
});

inbox.post('/conversations/:id/assign', async (c) => {
  const conv = await load(c);
  const b = await body(c, z.object({ userId: z.string().uuid().nullable() }));
  await ctx.db.query('update conversations set assigned_to = $2 where id = $1', [conv.id, b.userId]);
  return c.json({ ok: true });
});

/** Teach the AI: turn a human reply into a knowledge-base answer for the preceding customer question. */
inbox.post('/messages/:messageId/learn', async (c) => {
  const org = c.get('org');
  const msg = await ctx.db.one<{ conversation_id: string; content: string; created_at: Date }>(
    `select conversation_id, content, created_at from messages where id = $1 and org_id = $2 and role in ('human', 'ai')`,
    [c.req.param('messageId'), org.id],
  );
  if (!msg) fail(404, 'Message not found');
  const q = await ctx.db.one<{ content: string }>(
    `select content from messages where conversation_id = $1 and role = 'customer' and created_at < $2 order by created_at desc limit 1`,
    [msg.conversation_id, msg.created_at],
  );
  if (!q) fail(400, 'No customer question precedes this message');
  await learn(org.id, q.content, msg.content, c.get('user').id);
  return c.json({ ok: true });
});

inbox.post('/action-runs/:runId', async (c) => {
  const b = await body(c, z.object({ approve: z.boolean() }));
  try {
    return c.json(await decideActionRun(c.get('org'), c.req.param('runId'), c.get('user').id, b.approve));
  } catch (e) {
    fail(409, (e as Error).message);
  }
});

inbox.post('/presence', async (c) => {
  const b = await body(c, z.object({ conversationId: z.string().uuid().nullable() }));
  heartbeat(c.get('org').id, c.get('user').id, c.get('user').name, b.conversationId);
  return c.json(listPresence(c.get('org').id));
});

/** Realtime stream for the dashboard: new messages, status changes, drafts, presence, ingestion progress. */
inbox.get('/stream', (c) => {
  const orgId = c.get('org').id;
  return streamSSE(c, async (stream) => {
    const queue: RelayEvent[] = [];
    let wake: (() => void) | null = null;
    const unsubscribe = subscribe(`org:${orgId}`, (e) => {
      queue.push(e);
      wake?.();
    });
    let open = true;
    stream.onAbort(() => {
      open = false;
      unsubscribe();
      wake?.();
    });
    await stream.writeSSE({ event: 'presence', data: JSON.stringify(listPresence(orgId)) });
    while (open) {
      while (queue.length) {
        const e = queue.shift()!;
        await stream.writeSSE({ event: e.type, data: JSON.stringify(e.data) });
      }
      await new Promise<void>((r) => {
        wake = r;
        setTimeout(r, 25_000);
      });
      wake = null;
      if (!queue.length && open) await stream.writeSSE({ event: 'ping', data: '{}' });
    }
  });
});
