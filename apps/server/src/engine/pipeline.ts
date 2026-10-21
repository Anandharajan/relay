import { ctx } from '../ctx.ts';
import { uuid } from '../lib/crypto.ts';
import { publish } from '../lib/events.ts';
import { redact, type Vault } from '../lib/redact.ts';
import { detectLanguage, languageNames } from '../lib/text.ts';
import { recordRun } from '../services/agents.ts';
import type { Org } from '../services/orgs.ts';
import { dayBounds, formatWhen, freeSlots, listStaff, queueFor } from '../services/visits.ts';
import { extractDate, extractMedicines, extractObservations, flagFor, TESTS } from '../services/records.ts';
import { answer } from './answer.ts';
import { bookingIntent, changeIntent, matchStaff, preferredStart } from './booking.ts';
import { asksMedicalAdvice, isEmergency, maskHealth } from './safety.ts';
import { t } from './i18n.ts';
import { executeAction, extractParams, loadActions, matchActionByKeywords, renderTemplate } from './actions.ts';

/**
 * Agent pipelines: one input, a team of agents working in stages (several at once where they can),
 * and a report that fills in as each agent finishes. Every state change is streamed on `run:<id>`.
 *
 *  message  — a patient/visitor message → safety, language, routing, knowledge, booking and lookups in parallel → reply
 *  report   — a lab report or prescription → intake, ranges, critical values, medicines in parallel → doctor brief + draft message
 *  day      — "brief me on today" (staff only) → queue, approvals, findings and follow-ups in parallel → day brief
 */

export type AgentStatus = 'waiting' | 'working' | 'done' | 'failed' | 'skipped';
export interface PipelineAgent {
  id: string;
  role: string;
  action: string;
  stage: number;
  status: AgentStatus;
  startedAt?: string;
  endedAt?: string;
  ms?: number;
  result?: string;
}
export interface ReportSection {
  id: string;
  title: string;
  kind: 'reply' | 'text' | 'list' | 'table' | 'callout' | 'chips';
  tone?: 'ok' | 'warn' | 'bad' | 'info';
  body?: string;
  items?: string[];
  rows?: string[][];
  head?: string[];
}
export interface PipelineRun {
  id: string;
  orgId: string;
  kind: 'message' | 'report' | 'day';
  title: string;
  status: 'running' | 'done' | 'failed';
  stages: string[];
  agents: PipelineAgent[];
  report: ReportSection[];
  startedAt: string;
  endedAt?: string;
  ms?: number;
  public: boolean;
  data?: Record<string, unknown>;
}

const runs = new Map<string, PipelineRun>();
const TTL = 60 * 60_000;
function gc() {
  const cut = Date.now() - TTL;
  for (const [id, r] of runs) if (new Date(r.startedAt).getTime() < cut) runs.delete(id);
}

export function getRun(id: string) {
  return runs.get(id);
}

export function recentRuns(orgId: string, limit = 8) {
  return [...runs.values()].filter((r) => r.orgId === orgId && !r.public).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit).map(snapshot);
}

/** What the browser sees (internal data stays on the server). */
export function snapshot(r: PipelineRun) {
  const { data: _d, ...rest } = r;
  return rest;
}

function emit(r: PipelineRun) {
  publish(`run:${r.id}`, 'run', snapshot(r));
}

function section(r: PipelineRun, s: ReportSection) {
  const i = r.report.findIndex((x) => x.id === s.id);
  if (i >= 0) r.report[i] = s;
  else r.report.push(s);
  emit(r);
}

/** Run one agent: mark it working, do the work, record its real duration and a one-line result. */
async function agent<T>(r: PipelineRun, id: string, fn: () => Promise<{ result: string; value?: T } | null>): Promise<T | undefined> {
  const a = r.agents.find((x) => x.id === id)!;
  a.status = 'working';
  a.startedAt = new Date().toISOString();
  emit(r);
  const t0 = performance.now();
  try {
    const out = await fn();
    a.ms = Math.round(performance.now() - t0);
    a.endedAt = new Date().toISOString();
    if (!out) {
      a.status = 'skipped';
      a.result = 'Not needed for this input';
    } else {
      a.status = 'done';
      a.result = out.result;
    }
    emit(r);
    return out?.value;
  } catch (e) {
    a.ms = Math.round(performance.now() - t0);
    a.endedAt = new Date().toISOString();
    a.status = 'failed';
    a.result = (e as Error).message.slice(0, 160);
    emit(r);
    return undefined;
  }
}

function skip(r: PipelineRun, ids: string[], why: string) {
  for (const id of ids) {
    const a = r.agents.find((x) => x.id === id);
    if (a && a.status === 'waiting') {
      a.status = 'skipped';
      a.result = why;
    }
  }
  emit(r);
}

function newRun(org: Org, kind: PipelineRun['kind'], title: string, stages: string[], agents: Omit<PipelineAgent, 'status'>[], isPublic: boolean): PipelineRun {
  gc();
  const r: PipelineRun = {
    id: uuid(), orgId: org.id, kind, title, status: 'running', stages,
    agents: agents.map((a) => ({ ...a, status: 'waiting' })), report: [], startedAt: new Date().toISOString(), public: isPublic,
  };
  runs.set(r.id, r);
  return r;
}

async function finish(r: PipelineRun, failed = false) {
  r.status = failed ? 'failed' : 'done';
  r.endedAt = new Date().toISOString();
  r.ms = new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime();
  emit(r);
  const bad = r.agents.filter((a) => a.status === 'failed');
  await recordRun({
    orgId: r.orgId,
    agent: 'pipeline' as any,
    trigger: `${r.kind}${r.public ? ':public' : ''}`,
    status: bad.length ? 'failed' : 'ok',
    outcome: `${r.kind} pipeline · ${r.agents.filter((a) => a.status === 'done').length} agents · ${r.ms} ms`,
    tags: bad.map((a) => `pipeline.${a.id}.failed`),
    steps: r.agents.map((a) => ({ name: a.id, detail: `${a.status}${a.ms !== undefined ? ` ${a.ms}ms` : ''}` })),
    latencyMs: r.ms,
    complexity: r.kind === 'message' ? 1 : 3,
  });
}

/** Decide which pipeline fits the input. */
export function classify(text: string, hasFile: boolean, canBrief: boolean): PipelineRun['kind'] {
  if (canBrief && /^\s*(brief me|today'?s? (brief|summary|plan)|day brief|summari[sz]e today|what('?s| is) (happening|pending) today|இன்றைய (சுருக்கம்|நிலை))/i.test(text)) return 'day';
  if (hasFile || extractObservations(text).length >= 2) return 'report';
  return 'message';
}

export function startPipeline(org: Org, input: { text: string; kind: PipelineRun['kind']; isPublic: boolean }) {
  const r =
    input.kind === 'report' ? reportRun(org, input.text, input.isPublic) : input.kind === 'day' ? dayRun(org) : messageRun(org, input.text, input.isPublic);
  // Work continues in the background; the browser follows the stream.
  void Promise.resolve()
    .then(() => (input.kind === 'report' ? runReport(org, r, input.text) : input.kind === 'day' ? runDay(org, r) : runMessage(org, r, input.text)))
    .then(() => finish(r))
    .catch(async (e) => {
      section(r, { id: 'error', title: 'Something went wrong', kind: 'callout', tone: 'bad', body: (e as Error).message });
      await finish(r, true);
    });
  return snapshot(r);
}

// ── message pipeline ─────────────────────────────────────────────────────────────────────────────
function messageRun(org: Org, text: string, isPublic: boolean) {
  return newRun(org, 'message', text.slice(0, 80), ['Understand', 'Work in parallel', 'Reply', 'Check'], [
    { id: 'language', role: 'Language agent', action: 'Detects the language and script', stage: 0 },
    { id: 'safety', role: 'Safety agent', action: 'Screens for emergencies and medical-advice questions', stage: 0 },
    { id: 'privacy', role: 'Privacy agent', action: 'Masks phone numbers, IDs and health terms before any model sees them', stage: 0 },
    { id: 'router', role: 'Router agent', action: 'Works out what the person needs', stage: 0 },
    { id: 'knowledge', role: 'Front-desk agent', action: 'Answers from the help desk content, with sources', stage: 1 },
    { id: 'booking', role: 'Booking agent', action: 'Finds free appointment slots', stage: 1 },
    { id: 'lookup', role: 'Lookup agent', action: 'Checks systems such as lab report status', stage: 1 },
    { id: 'composer', role: 'Reply agent', action: 'Writes one reply from the agents’ results', stage: 2 },
    { id: 'reviewer', role: 'Review agent', action: 'Checks the reply: language, sources, safety', stage: 3 },
  ], isPublic);
}

async function runMessage(org: Org, r: PipelineRun, text: string) {
  const healthcare = org.settings.vertical === 'healthcare';
  const vault: Vault = {};
  const [lang, safety, masked, intent] = await Promise.all([
    agent(r, 'language', async () => {
      const l = detectLanguage(text);
      return { result: languageNames[l] ?? l, value: l };
    }),
    agent(r, 'safety', async () => {
      const emergency = healthcare && isEmergency(text);
      const advice = healthcare && asksMedicalAdvice(text);
      return { result: emergency ? 'EMERGENCY: escalate now' : advice ? 'Medical-advice question: route to a clinician' : 'Clear', value: { emergency, advice } };
    }),
    agent(r, 'privacy', async () => {
      let out = redact(text, vault).text;
      if (healthcare) out = maskHealth(out, vault);
      const n = Object.keys(vault).length;
      return { result: n ? `${n} item${n > 1 ? 's' : ''} masked` : 'Nothing personal found', value: out };
    }),
    agent(r, 'router', async () => {
      const staff = await listStaff(org.id);
      const actions = await loadActions(org.id);
      const action = matchActionByKeywords(text, actions);
      const actionReady = action && Object.keys(extractParams(text, action).params).length > 0 ? action : null;
      const change = changeIntent(text);
      const booking = !change && staff.length > 0 && bookingIntent(text);
      const label = change ? 'Change or cancel a booking' : booking ? 'Book an appointment' : actionReady ? `Look up: ${actionReady.name}` : 'Question for the help desk';
      return { result: label, value: { booking, change, action: actionReady && !change ? actionReady : null, staff } };
    }),
  ]);
  const L = lang ?? 'en';
  section(r, {
    id: 'understood', title: 'Understood', kind: 'chips',
    items: [languageNames[L] ?? L, intent ? (intent.booking ? 'Booking' : intent.action ? intent.action.name : 'Question') : 'Question', safety?.emergency ? '⚠️ Emergency' : safety?.advice ? 'Clinical question' : 'Safe to answer', Object.keys(vault).length ? `${Object.keys(vault).length} private item(s) masked` : 'No personal data'],
  });

  // Safety stops everything else.
  if (safety?.emergency || safety?.advice) {
    skip(r, ['knowledge', 'booking', 'lookup'], 'Stopped by the safety agent');
    const reply = safety.emergency ? t('emergency', L, { number: org.settings.emergencyNumber || '108' }) : t('noMedicalAdvice', L, { number: org.settings.emergencyNumber || '108' });
    await agent(r, 'composer', async () => ({ result: safety.emergency ? 'Emergency reply preview; staff alert required' : 'Clinical hand-off preview' }));
    section(r, { id: 'reply', title: 'Reply', kind: 'reply', tone: safety.emergency ? 'bad' : 'warn', body: reply });
    await agent(r, 'reviewer', async () => ({ result: 'No diagnosis, dose or interpretation given ✓' }));
    section(r, {
      id: 'next', title: 'What happens next', kind: 'list',
      items: safety.emergency
        ? ['Preview only: no staff alert or inbox conversation was created. Contact the clinical team directly.', `Call ${org.settings.emergencyNumber || '108'} now.`, 'No AI advice is given.']
        : ['Preview only: no message was sent to a doctor or nurse.', 'Use patient chat to create a conversation for staff.'],
    });
    return;
  }

  // Stage 2: three agents at once.
  const [kb, slots, lookup] = await Promise.all([
    agent(r, 'knowledge', async () => {
      if (intent?.change) return { result: 'Not needed: staff handle changes', value: null };
      const out = await answer({ org, question: text, dryRun: true, skipActions: true });
      return { result: out.kind === 'answer' ? `Answered (confidence ${Math.round(out.confidence * 100)}%, ${out.citations.length} source${out.citations.length === 1 ? '' : 's'})` : out.kind === 'smalltalk' ? 'Greeting, no lookup needed' : 'No confident answer in the help desk', value: out };
    }),
    agent(r, 'booking', async () => {
      if (!intent?.booking) return null;
      const matched = matchStaff(text, intent.staff);
      const general = intent.staff.filter((s) => /general|family|physician/i.test(s.specialty ?? ''));
      const who = (matched.length ? matched : general.length ? general : intent.staff).slice(0, 2);
      const lists = await Promise.all(who.map(async (s) => ({ s, slots: await freeSlots(org, s, 3, preferredStart(text, org)) })));
      const total = lists.reduce((n, x) => n + x.slots.length, 0);
      return { result: `${total} free slot${total === 1 ? '' : 's'} with ${who.map((w) => w.name).join(', ')}`, value: lists };
    }),
    agent(r, 'lookup', async () => {
      if (!intent?.action) return null;
      const { params } = extractParams(text, intent.action);
      const res = await executeAction(intent.action, params);
      if (!res.ok) throw new Error(`Lookup failed: ${res.error}`);
      return { result: `${intent.action.name}: done`, value: renderTemplate(intent.action.response_template, res.data) };
    }),
  ]);

  // Stage 3: compose.
  let reply = '';
  let tone = 'ok' as ReportSection['tone'];
  const sources = kb?.citations ?? [];
  await agent(r, 'composer', async () => {
    if (slots?.length) {
      const many = slots.filter((x) => x.slots.length).length > 1;
      const list = slots.flatMap((x) => x.slots.map((d) => (many ? `${x.s.name}: ` : '') + formatWhen(d, org, L))).map((s, i) => `${i + 1}. ${s}`).join('\n');
      reply = list ? t('chooseSlot', L, { staff: slots.filter((x) => x.slots.length).map((x) => x.s.name).join(' / '), list }) : t('noSlots', L);
      return { result: 'Offered the next free slots' };
    }
    if (lookup) {
      reply = lookup;
      return { result: 'Used the lookup result' };
    }
    if (intent?.change) {
      reply = t('handoff', L);
      return { result: 'Passed to the front desk to change or cancel' };
    }
    if ((kb?.kind === 'answer' || kb?.kind === 'smalltalk') && kb.text) {
      reply = kb.text;
      return { result: 'Used the help-desk answer' };
    }
    reply = t('handoff', L);
    tone = 'warn';
    return { result: 'Handed to a person (not sure enough to answer)' };
  });
  section(r, { id: 'reply', title: 'Reply', kind: 'reply', tone, body: reply });
  if (sources.length && !slots?.length && !lookup) section(r, { id: 'sources', title: 'Sources', kind: 'list', items: sources.map((c) => `${c.title}: “${c.snippet}”`) });

  await agent(r, 'reviewer', async () => {
    const checks = [
      detectLanguage(reply) === L || L === 'en' ? 'language matches' : 'language differs',
      sources.length || slots?.length || lookup ? 'grounded' : 'handed off',
      healthcare && asksMedicalAdvice(reply) ? 'contains advice ✗' : 'no medical advice',
    ];
    return { result: checks.join(' · ') };
  });
  section(r, {
    id: 'next', title: 'What happens next', kind: 'list',
    items: slots?.length
      ? ['The person replies with a number; the booking agent confirms, issues a token and a visit link.', 'Reminders and any doctor-approved preparation instructions are scheduled automatically.']
      : tone === 'warn'
        ? ['Preview only: this draft has not been added to the team inbox.', 'Use patient chat to create a conversation for staff.']
        : ['Preview only: this reply has not been sent on WhatsApp or web chat.', 'Use patient chat to start a conversation with the team.'],
  });
}

// ── report pipeline ──────────────────────────────────────────────────────────────────────────────
function reportRun(org: Org, text: string, isPublic: boolean) {
  const title = (text.split('\n').find((l) => l.trim().length > 3) ?? 'Report').slice(0, 80);
  return newRun(org, 'report', title, ['Read', 'Check in parallel', 'Plan', 'Brief'], [
    { id: 'privacy', role: 'Privacy agent', action: 'Masks names, phone numbers and IDs', stage: 0 },
    { id: 'intake', role: 'Intake agent', action: 'Reads test results, units and reference ranges', stage: 0 },
    { id: 'medicines', role: 'Medicines agent', action: 'Lists medicines on the document', stage: 0 },
    { id: 'classifier', role: 'Document agent', action: 'Works out the report type and date', stage: 0 },
    { id: 'ranges', role: 'Range agent', action: 'Compares every value with its reference range', stage: 1 },
    { id: 'critical', role: 'Critical-value agent', action: 'Looks for values that need same-day attention', stage: 1 },
    { id: 'patterns', role: 'Pattern agent', action: 'Spots known patterns (sugar, kidney, lipids, thyroid)', stage: 1 },
    { id: 'tests', role: 'Investigations agent', action: 'Suggests follow-up tests for the doctor to order', stage: 2 },
    { id: 'drafter', role: 'Patient-message agent', action: 'Drafts a non-diagnostic message (held for the doctor)', stage: 2 },
    { id: 'brief', role: 'Doctor-brief agent', action: 'Writes the one-page brief for the doctor', stage: 3 },
  ], isPublic);
}

async function runReport(org: Org, r: PipelineRun, text: string) {
  const vault: Vault = {};
  const [, obs, meds, doc] = await Promise.all([
    agent(r, 'privacy', async () => {
      redact(text, vault);
      const n = Object.keys(vault).length;
      return { result: n ? `${n} personal item(s) masked` : 'No personal identifiers found' };
    }),
    agent(r, 'intake', async () => {
      const o = extractObservations(text).map((x) => ({ ...x, flag: flagFor(x) }));
      return { result: o.length ? `${o.length} result${o.length > 1 ? 's' : ''} read` : 'No results recognised', value: o };
    }),
    agent(r, 'medicines', async () => {
      const m = extractMedicines(text);
      return { result: m.length ? `${m.length} medicine${m.length > 1 ? 's' : ''}` : 'None listed', value: m };
    }),
    agent(r, 'classifier', async () => {
      const date = extractDate(text);
      const kind = /discharge summary/i.test(text) ? 'Discharge summary' : /\b(rx|tab\.|cap\.)/i.test(text) && extractObservations(text).length < 2 ? 'Prescription' : 'Lab report';
      return { result: `${kind}${date ? ` · ${date}` : ''}`, value: { kind, date } };
    }),
  ]);
  const results = obs ?? [];
  if (results.length) {
    section(r, {
      id: 'results', title: `Results (${doc?.kind ?? 'report'}${doc?.date ? `, ${doc.date}` : ''})`, kind: 'table',
      head: ['Test', 'Value', 'Reference', 'Flag'],
      rows: results.map((o) => [o.label, `${Math.round(o.value * 100) / 100} ${o.unit}`, o.ref_low !== null && o.ref_high !== null ? `${o.ref_low}–${o.ref_high}` : o.ref_high !== null ? `< ${o.ref_high}` : o.ref_low !== null ? `> ${o.ref_low}` : '—', o.flag.replace('_', ' ')]),
    });
  } else {
    section(r, { id: 'results', title: 'Results', kind: 'callout', tone: 'info', body: 'No lab values recognised. Scanned photos need OCR or manual entry; typed reports and PDFs work best.' });
  }
  if (meds?.length) section(r, { id: 'meds', title: 'Medicines on the document', kind: 'chips', items: meds });

  const [abnormal, critical, patterns] = await Promise.all([
    agent(r, 'ranges', async () => {
      const a = results.filter((o) => o.flag !== 'normal');
      return { result: `${a.length} of ${results.length} outside range`, value: a };
    }),
    agent(r, 'critical', async () => {
      const c = results.filter((o) => o.flag.startsWith('critical'));
      return { result: c.length ? `${c.length} critical: ${c.map((x) => x.label).join(', ')}` : 'None critical', value: c };
    }),
    agent(r, 'patterns', async () => {
      const by = Object.fromEntries(results.map((o) => [o.test, o]));
      const p: string[] = [];
      if ((by.hba1c?.value ?? 0) >= 6.5 || (by.fbs?.value ?? 0) >= 126) p.push('Blood sugar in the diabetic range');
      else if ((by.hba1c?.value ?? 0) >= 5.7 || (by.fbs?.value ?? 0) >= 100) p.push('Blood sugar in the pre-diabetic range');
      if ((by.creat && by.creat.flag !== 'normal') || (by.urea && by.urea.flag !== 'normal')) p.push('Kidney markers outside range');
      if ((by.ldl && by.ldl.flag !== 'normal') || (by.tc && by.tc.flag !== 'normal') || (by.tg && by.tg.flag !== 'normal')) p.push('Lipids outside target');
      if (by.tsh && by.tsh.flag !== 'normal') p.push('Thyroid (TSH) outside range');
      if (by.hb && by.hb.flag !== 'normal') p.push('Haemoglobin outside range');
      if ((by.sbp?.value ?? 0) >= 140 || (by.dbp?.value ?? 0) >= 90) p.push('Blood pressure above target');
      return { result: p.length ? p.join('; ') : 'No known pattern', value: p };
    }),
  ]);
  if (critical?.length) {
    section(r, { id: 'critical', title: 'Needs same-day review', kind: 'callout', tone: 'bad', body: critical.map((c) => `${c.label} ${Math.round(c.value * 100) / 100} ${c.unit}`).join(' · ') + '. Preview only: no doctor has been alerted. Contact the clinical team directly.' });
  }

  const [tests, draft] = await Promise.all([
    agent(r, 'tests', async () => {
      const keys = new Set(results.map((o) => o.test));
      const s: string[] = [];
      const add = (k: string, why: string) => !keys.has(k) && s.push(`${TESTS.find((x) => x.key === k)?.label ?? k}: ${why}`);
      if (patterns?.some((p) => p.includes('diabetic'))) {
        add('hba1c', 'confirms the 3-month sugar average');
        add('creat', 'kidney check, usually yearly with diabetes');
        add('ldl', 'lipid profile, usually yearly with diabetes');
      }
      if (patterns?.some((p) => p.includes('Kidney'))) add('k', 'potassium with kidney markers');
      if (patterns?.some((p) => p.includes('Haemoglobin'))) add('b12', 'common cause of low haemoglobin');
      if (patterns?.some((p) => p.includes('Thyroid'))) s.push('Repeat TSH in 6–8 weeks: confirms the thyroid result');
      return { result: s.length ? `${s.length} suggestion${s.length > 1 ? 's' : ''} for the doctor` : 'Nothing to add', value: s };
    }),
    agent(r, 'drafter', async () => {
      const urgent = Boolean(critical?.length);
      const ta = detectLanguage(text) === 'ta';
      const body = !abnormal?.length
        ? ta ? 'வணக்கம், உங்கள் அறிக்கை கிடைத்தது. மருத்துவர் பார்த்த பிறகு உங்களுக்குத் தெரிவிப்போம்.' : 'Hello, we have received your report. Your doctor will review it and we will update you here.'
        : ta
          ? `வணக்கம், உங்கள் சமீபத்திய பரிசோதனை முடிவுகளை மருத்துவர் பார்த்தார். இது குறித்து உங்களுடன் பேச விரும்புகிறார். ${urgent ? 'இன்றே மருத்துவமனையை அழைக்கவும்.' : 'உங்கள் அடுத்த வருகையில் விவாதிப்போம்.'}`
          : `Hello, your doctor has reviewed your recent test results and would like to discuss them with you. ${urgent ? 'Please call the hospital today.' : 'We will go over them at your next visit.'}`;
      if (asksMedicalAdvice(body)) throw new Error('Draft contained advice and was blocked');
      return { result: 'Draft preview ready; not submitted for approval', value: body };
    }),
  ]);

  await agent(r, 'brief', async () => {
    const lines: string[] = [];
    if (critical?.length) lines.push(`URGENT: ${critical.map((c) => `${c.label} ${Math.round(c.value * 100) / 100} ${c.unit}`).join(', ')}.`);
    const other = (abnormal ?? []).filter((o) => !o.flag.startsWith('critical'));
    if (other.length) lines.push(`Outside range: ${other.map((o) => `${o.label} ${Math.round(o.value * 100) / 100} ${o.unit} (${o.flag})`).join(', ')}.`);
    if (patterns?.length) lines.push(`Patterns: ${patterns.join('; ')}.`);
    if (meds?.length) lines.push(`Medicines on file: ${meds.join(', ')}.`);
    if (!lines.length) lines.push(results.length ? 'All recognised values are within range.' : 'Nothing structured could be read from this document.');
    section(r, { id: 'brief', title: 'Doctor brief', kind: 'text', tone: critical?.length ? 'bad' : abnormal?.length ? 'warn' : 'ok', body: lines.join('\n') });
    return { result: `${lines.length} line brief` };
  });
  if (tests?.length) section(r, { id: 'tests', title: 'Suggested investigations (doctor decides)', kind: 'list', items: tests });
  if (draft) section(r, { id: 'draft', title: 'Patient message preview: not submitted for approval', kind: 'reply', tone: 'info', body: draft });
  section(r, { id: 'note', title: 'Safety', kind: 'callout', tone: 'info', body: 'Preview only: this report is not saved to a patient, no approval request is created and no message is sent. Use Patients to save a report for clinical review. Agents flag and organise; they do not diagnose.' });
}

// ── day brief (staff) ────────────────────────────────────────────────────────────────────────────
function dayRun(org: Org) {
  return newRun(org, 'day', 'Today’s brief', ['Gather in parallel', 'Brief'], [
    { id: 'queue', role: 'Queue agent', action: 'Reads every doctor’s queue and waiting times', stage: 0 },
    { id: 'approvals', role: 'Approvals agent', action: 'Counts messages and findings waiting for a doctor', stage: 0 },
    { id: 'urgent', role: 'Urgent-findings agent', action: 'Lists critical results from reports', stage: 0 },
    { id: 'inbox', role: 'Inbox agent', action: 'Finds conversations waiting for staff', stage: 0 },
    { id: 'followups', role: 'Follow-up agent', action: 'Finds patients who replied “worse” and overdue tests', stage: 0 },
    { id: 'brief', role: 'Brief agent', action: 'Writes the priorities for the next hour', stage: 1 },
  ], false);
}

async function runDay(org: Org, r: PipelineRun) {
  const { start, end } = dayBounds(new Date(), org.settings.utcOffsetMin);
  const [queues, approvals, urgent, inbox, follow] = await Promise.all([
    agent(r, 'queue', async () => {
      const staff = await listStaff(org.id);
      const q = await Promise.all(staff.map((s) => queueFor(org, s.id)));
      const waiting = q.reduce((n, x) => n + x.waiting.length, 0);
      return { result: `${waiting} waiting across ${staff.length} staff`, value: q };
    }),
    agent(r, 'approvals', async () => {
      const m = await ctx.db.one<{ c: number }>(`select count(*)::int as c from outbox where org_id = $1 and status = 'pending_approval'`, [org.id]);
      return { result: `${m?.c ?? 0} messages to approve`, value: m?.c ?? 0 };
    }),
    agent(r, 'urgent', async () => {
      const rows = await ctx.db.query<{ name: string; title: string }>(
        `select c.name, f.title from findings f join clients c on c.id = f.client_id where f.org_id = $1 and f.status = 'open' and f.severity = 'urgent' order by f.created_at desc limit 10`,
        [org.id],
      );
      return { result: rows.length ? `${rows.length} urgent` : 'None', value: rows };
    }),
    agent(r, 'inbox', async () => {
      const n = await ctx.db.one<{ c: number }>(`select count(*)::int as c from conversations where org_id = $1 and status = 'escalated'`, [org.id]);
      return { result: `${n?.c ?? 0} waiting for staff`, value: n?.c ?? 0 };
    }),
    agent(r, 'followups', async () => {
      const worse = await ctx.db.query<{ name: string }>(`select c.name from followups f join clients c on c.id = f.client_id where f.org_id = $1 and f.status = 'worse' and f.due_at > now() - interval '3 days'`, [org.id]);
      const overdue = await ctx.db.one<{ c: number }>(`select count(*)::int as c from investigations where org_id = $1 and status = 'overdue'`, [org.id]);
      return { result: `${worse.length} worse · ${overdue?.c ?? 0} overdue tests`, value: { worse, overdue: overdue?.c ?? 0 } };
    }),
  ]);
  void start;
  void end;
  await agent(r, 'brief', async () => {
    const items: string[] = [];
    for (const u of urgent ?? []) items.push(`⚠️ ${u.name}: ${u.title}`);
    for (const w of follow?.worse ?? []) items.push(`📞 Call ${w.name}: replied “worse” to the check-in`);
    if (approvals) items.push(`✅ ${approvals} patient message${approvals > 1 ? 's' : ''} waiting for approval`);
    if (inbox) items.push(`💬 ${inbox} conversation${inbox > 1 ? 's' : ''} waiting for a reply`);
    for (const q of queues ?? []) if (q.waiting.length) items.push(`🗓️ ${q.staff.name}: ${q.waiting.length} waiting, longest about ${Math.max(...q.waiting.map((w) => w.etaMin))} min`);
    if (follow?.overdue) items.push(`🧪 ${follow.overdue} ordered test${follow.overdue > 1 ? 's are' : ' is'} overdue (reminders sent)`);
    section(r, { id: 'priorities', title: 'Priorities now', kind: 'list', items: items.length ? items : ['Nothing urgent. All queues and approvals are clear.'] });
    section(r, {
      id: 'queues', title: 'Queues', kind: 'table', head: ['Staff', 'Now seeing', 'Waiting', 'Booked'],
      rows: (queues ?? []).map((q) => [q.staff.name, q.current?.client.name ?? '—', String(q.waiting.length), String(q.upcoming.length)]),
    });
    return { result: `${items.length} priorities` };
  });
}
