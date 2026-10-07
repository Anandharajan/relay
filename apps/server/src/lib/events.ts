import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db.ts';

/**
 * Pub/sub that powers the realtime inbox and widget streams.
 * Channels: `org:<id>` for dashboards, `conv:<id>` for a single conversation.
 *
 * Every event is emitted locally; on Postgres it is also broadcast with LISTEN/NOTIFY so any
 * number of server instances behind a load balancer see each other's events (an SSE client is
 * connected to one instance, but the AI reply may be produced on another).
 */
export interface RelayEvent {
  type: string;
  data: unknown;
}

const BUS_CHANNEL = 'relay_events';
// Postgres NOTIFY payloads are capped at 8000 bytes.
const MAX_PAYLOAD = 7800;
const nodeId = randomUUID();
const bus = new EventEmitter();
bus.setMaxListeners(0);
let remote: Db | null = null;

type Wire =
  | { origin: string; k: 'event'; channel: string; type: string; data?: unknown; ref?: string }
  | { origin: string; k: 'heartbeat'; orgId: string; userId: string; name: string; conversationId: string | null };

function emitLocal(channel: string, type: string, data: unknown) {
  bus.emit(channel, { type, data } satisfies RelayEvent);
}

function broadcast(msg: Wire) {
  if (!remote?.notify) return;
  let payload = JSON.stringify(msg);
  if (Buffer.byteLength(payload) > MAX_PAYLOAD) {
    // Large messages (long Indic-script replies) travel by reference; receivers load them from the DB.
    const id = msg.k === 'event' ? (msg.data as { id?: string } | null)?.id : undefined;
    if (msg.k !== 'event' || !id || !msg.type.startsWith('message')) {
      console.warn(`[bus] dropping oversize ${msg.k === 'event' ? msg.type : msg.k} event for other instances`);
      return;
    }
    payload = JSON.stringify({ origin: msg.origin, k: 'event', channel: msg.channel, type: msg.type, ref: id } satisfies Wire);
  }
  remote.notify(BUS_CHANNEL, payload).catch((e) => console.error('[bus] notify failed:', (e as Error).message));
}

export function publish(channel: string, type: string, data: unknown) {
  emitLocal(channel, type, data);
  broadcast({ origin: nodeId, k: 'event', channel, type, data });
}

export function subscribe(channel: string, fn: (e: RelayEvent) => void): () => void {
  bus.on(channel, fn);
  return () => bus.off(channel, fn);
}

/** Enable cross-instance delivery. No-op on embedded PGlite (always a single process). */
export async function initBus(db: Db) {
  if (db.kind !== 'postgres' || !db.listen || !db.notify) return;
  await db.listen(BUS_CHANNEL, (payload) => {
    void (async () => {
      const m = JSON.parse(payload) as Wire;
      if (m.origin === nodeId) return;
      if (m.k === 'heartbeat') return applyHeartbeat(m.orgId, m.userId, m.name, m.conversationId);
      let data = m.data;
      if (m.ref) {
        const row = await db.one('select * from messages where id = $1', [m.ref]);
        if (!row) return;
        // Same shape as services/conversations.publicMessage for the customer-facing stream.
        data = m.type === 'message'
          ? { id: row.id, role: row.role === 'human' ? 'agent' : row.role, content: row.content, citations: row.citations, created_at: row.created_at }
          : row;
      }
      emitLocal(m.channel, m.type, data);
    })().catch((e) => console.error('[bus] bad event:', (e as Error).message));
  });
  remote = db;
  console.log('[bus] cross-instance realtime enabled (Postgres LISTEN/NOTIFY)');
}

/** Presence: who is looking at which conversation, expiring after 30s without a heartbeat. */
const presence = new Map<string, Map<string, { name: string; conversationId: string | null; at: number }>>();

function applyHeartbeat(orgId: string, userId: string, name: string, conversationId: string | null) {
  let org = presence.get(orgId);
  if (!org) presence.set(orgId, (org = new Map()));
  org.set(userId, { name, conversationId, at: Date.now() });
  emitLocal(`org:${orgId}`, 'presence', listPresence(orgId));
}

export function heartbeat(orgId: string, userId: string, name: string, conversationId: string | null) {
  applyHeartbeat(orgId, userId, name, conversationId);
  broadcast({ origin: nodeId, k: 'heartbeat', orgId, userId, name, conversationId });
}

export function listPresence(orgId: string) {
  const org = presence.get(orgId);
  if (!org) return [];
  const now = Date.now();
  const out: { userId: string; name: string; conversationId: string | null }[] = [];
  for (const [userId, p] of org) {
    if (now - p.at > 30_000) org.delete(userId);
    else out.push({ userId, name: p.name, conversationId: p.conversationId });
  }
  return out;
}
