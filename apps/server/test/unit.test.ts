import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, restore } from '../src/lib/redact.ts';
import { chunkDocument, detectLanguage } from '../src/lib/text.ts';
import { extractiveAnswer } from '../src/engine/extractive.ts';
import { detectDrift, extractParams, matchActionByKeywords, renderTemplate, type ActionDef } from '../src/engine/actions.ts';
import { judge } from '../src/jobs/simulate.ts';
import { smalltalk, wantsHuman } from '../src/engine/i18n.ts';
import type { Passage } from '../src/engine/retrieve.ts';

test('redacts Indian PII and restores it', () => {
  const input = 'Mail me at asha@example.com or call +91 98765 43210. PAN ABCDE1234F, card 4111 1111 1111 1111, upi asha@okicici';
  const { text, vault } = redact(input);
  for (const secret of ['asha@example.com', '98765 43210', 'ABCDE1234F', '4111 1111 1111 1111', 'asha@okicici']) assert.ok(!text.includes(secret), `leaked ${secret}: ${text}`);
  assert.match(text, /\[EMAIL_1\]/);
  assert.match(text, /\[PAN_1\]/);
  assert.match(text, /\[CARD_1\]/);
  assert.equal(restore(text, vault), input);
});

test('does not treat order IDs or prices as PII', () => {
  const { text } = redact('Order KC-1042 costs ₹2,000 and ships in 3-5 days');
  assert.equal(text, 'Order KC-1042 costs ₹2,000 and ships in 3-5 days');
});

test('detects Indic scripts', () => {
  assert.equal(detectLanguage('डिलीवरी में कितने दिन लगते हैं?'), 'hi');
  assert.equal(detectLanguage('ಡೆಲಿವರಿಗೆ ಎಷ್ಟು ದಿನ ಬೇಕು?'), 'kn');
  assert.equal(detectLanguage('டெலிவரி எத்தனை நாட்கள்?'), 'ta');
  assert.equal(detectLanguage('How long is delivery?'), 'en');
});

test('chunker keeps FAQ pairs together under headings', () => {
  const chunks = chunkDocument('# Shipping\nQ: How long?\nA: 3 days.\n\nQ: Free shipping?\nA: Above ₹599.\n# Returns\nUnopened items within 7 days.');
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0]!.title, 'Shipping');
  assert.match(chunks[1]!.content, /Free shipping\?\nA: Above ₹599/);
  assert.equal(chunks[2]!.title, 'Returns');
});

const passage = (content: string, title = 'FAQ', similarity = 0.5): Passage => ({ id: content.slice(0, 8), sourceId: 's', title, url: null, content, similarity, keyword: 0.1, score: 1 });

test('extractive engine answers FAQ pairs with high confidence', () => {
  const out = extractiveAnswer('how long does delivery take', [passage('Q: How long does delivery take?\nA: 2-3 business days in metro cities.')]);
  assert.equal(out.answer, '2-3 business days in metro cities.');
  assert.ok(out.confidence > 0.8);
});

test('extractive engine never quotes question lines', () => {
  const out = extractiveAnswer('do you sell chicory', [passage('Q: Do you sell chicory blends?\nA: Yes, our Filter Coffee Kit uses an 80:20 coffee-chicory blend.')]);
  assert.ok(!out.answer.startsWith('Do you sell'), out.answer);
});

test('extractive engine has low confidence on unrelated questions', () => {
  const out = extractiveAnswer('do you sell green tea', [passage('Q: Which grind should I choose?\nA: Fine for espresso, coarse for French press.', 'FAQ', 0.15)]);
  assert.ok(out.confidence < 0.45, String(out.confidence));
});

const action = {
  id: 'a', org_id: 'o', name: 'Order status', description: '', keywords: ['order', 'track', 'where is my'], method: 'GET', url: 'http://x/{order_id}', headers_enc: null,
  params: [{ name: 'order_id', description: 'order ID', required: true, pattern: '(KC-?\\d{3,6})' }], body_template: null,
  response_template: 'Order {{id}} is {{status}}', sensitive: false, enabled: true, health: 'ok', last_error: null,
} satisfies ActionDef;

test('keyword routing and param extraction', () => {
  assert.equal(matchActionByKeywords('where is my order KC-1042?', [action])?.name, 'Order status');
  assert.equal(matchActionByKeywords('how long does delivery take', [action]), null);
  assert.deepEqual(extractParams('it is kc-1042', action).params, { order_id: 'kc-1042' });
  assert.equal(extractParams('no id here', action).missing.length, 1);
});

test('response templates and self-healing drift detection', () => {
  assert.equal(renderTemplate('Order {{id}} is {{status}}', { id: 'KC-1', status: 'Shipped' }), 'Order KC-1 is Shipped');
  const drift = detectDrift('Order {{id}} is {{status}} via {{courier}}', { order_id: 'KC-1', order_status: 'Shipped', shipping: { carrier: 'Delhivery' } });
  assert.deepEqual(drift.missing, ['id', 'status', 'courier']);
  assert.equal(drift.proposals.id, 'order_id');
  assert.equal(drift.proposals.status, 'order_status');
});

test('simulation judge', () => {
  assert.equal(judge('handoff', 'x', null).passed, false);
  assert.equal(judge('answer', 'Shipping is free above ₹599', '599|five hundred').passed, true);
  assert.equal(judge('answer', 'Shipping is free above ₹599', 'free, 499').passed, false);
});

test('handoff and small-talk intents across languages', () => {
  assert.ok(wantsHuman('I want to talk to a human'));
  assert.ok(wantsHuman('मुझे किसी इंसान से बात करनी है'));
  assert.ok(!wantsHuman('How long does delivery take?'));
  assert.equal(smalltalk('Namaste 🙏'), 'greeting');
  assert.equal(smalltalk('धन्यवाद'), 'thanks');
  assert.equal(smalltalk('thanks, where is my order?'), null);
});

test('safety: emergencies in Tamil/Hindi/English, and medical advice vs admin questions', async () => {
  const { isEmergency, asksMedicalAdvice, maskHealth } = await import('../src/engine/safety.ts');
  assert.ok(isEmergency('என் அப்பாவுக்கு நெஞ்சு வலி'));
  assert.ok(isEmergency('मेरी माँ बेहोश हो गई'));
  assert.ok(isEmergency('my father collapsed and is not responding'));
  assert.ok(!isEmergency('What are the OPD timings?'));
  assert.ok(asksMedicalAdvice('Can I take paracetamol with metformin?'));
  assert.ok(asksMedicalAdvice('Is my sugar level high?'));
  assert.ok(!asksMedicalAdvice('Is my report LAB-2042 ready?'));
  assert.ok(!asksMedicalAdvice('What is the consultation fee?'));
  const vault: Record<string, string> = {};
  assert.equal(maskHealth('I have diabetes and take metformin', vault), 'I have [HEALTH_1] and take [HEALTH_2]');
});

test('intake agent: lab values, ranges, units and medicines from report text', async () => {
  const { extractObservations, flagFor, extractMedicines, extractDate } = await import('../src/services/records.ts');
  const obs = extractObservations('Vitamin D (25-OH) 14 ng/mL 30 - 100\nLDL Cholesterol 162 mg/dL < 100\nTotal Cholesterol 236 mg/dL\nPlatelet Count 2.6 lakhs/uL\nPotassium 6.8 mmol/L 3.5 - 5.1\nBP: 152/96');
  const by = Object.fromEntries(obs.map((o) => [o.test, o]));
  assert.equal(by.vitd!.value, 14);
  assert.equal(by.ldl!.value, 162);
  assert.equal(by.tc!.value, 236);
  assert.equal(by.plt!.value, 260000);
  assert.equal(flagFor(by.k!), 'critical_high');
  assert.equal(by.sbp!.value, 152);
  assert.deepEqual(extractMedicines('Tab. Metformin 500 mg 1-0-1\nCap. Pantoprazole 40 mg'), ['Tab. Metformin 500 mg', 'Cap. Pantoprazole 40 mg']);
  assert.equal(extractDate('Date: 05/09/2026'), '2026-09-05');
});

// Persona regressions (colloquial Tamil/Hindi/English front-desk messages).
import { bookingIntent as _bi, changeIntent as _ci, matchStaff as _ms } from '../src/engine/booking.ts';
import { normalizeQuery as _nq } from '../src/lib/text.ts';
import { extractObservations as _eo } from '../src/services/records.ts';
import * as _safety from '../src/engine/safety.ts';

test('persona: booking and change intents', () => {
  for (const s of ['டாக்டர் பார்க்கணும் நாளைக்கு', 'checkup with Dr Kannan', 'need appt tomorrow']) assert.ok(_bi(s), s);
  assert.ok(_ci('cancel my appointment'));
  assert.ok(!_bi('cancel my appointment'));
  const staff = [{ name: 'Dr. Ravi', specialty: 'Orthopaedics' }, { name: 'Dr. Meena', specialty: 'Paediatrics' }, { name: 'Dr. Suresh', specialty: 'Nephrology' }] as any[];
  assert.deepEqual(_ms('my kid has fever', staff).map((s: any) => s.specialty), ['Paediatrics']);
  assert.ok(!_ms('kidney stone', staff).some((s: any) => s.specialty === 'Paediatrics'));
});

test('persona: romanised queries are expanded', () => {
  assert.match(_nq('doctor fees evvalavu'), /consultation fee/);
  assert.match(_nq('OPD timing enna'), /timings/);
});

test('persona: Tamil-labelled report values are read', () => {
  const obs = _eo('ஹீமோகுளோபின் 9.4 g/dL\nகிரியேட்டினின் 1.6 mg/dL');
  const keys = [...(obs as any).values?.() ?? obs].map((o: any) => o.test);
  assert.ok(keys.includes('hb') && keys.includes('creat'), JSON.stringify(keys));
});

test('LAB IDs with a space still extract', () => {
  const action = { params: [{ name: 'id', required: true, pattern: '\\b(LAB-\\d{3,})\\b' }] } as any;
  assert.equal(extractParams('is LAB 2041 ready', action).params.id, 'LAB-2041');
});

test('persona: safety catches colloquial clinical and emergency messages', () => {
  for (const s of ['7 months pregnant and bleeding', 'கர்ப்பமா இருக்கேன் ரத்தம் வருது']) assert.ok(_safety.isEmergency(s), s);
  for (const s of ['BP மாத்திரை நிறுத்தலாமா', 'my hba1c is 9 is it bad?', 'baby has 103 fever what to do']) assert.ok(_safety.asksMedicalAdvice(s) || _safety.isEmergency(s), s);
  assert.ok(!_safety.isEmergency('what are OPD timings'));
});
