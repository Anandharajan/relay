import type { ChatMessage } from '../lib/patientChat';

export const SAMPLE_PATIENT_REPORT = `SYNTHETIC LAB REPORT (fictional patient)
Antenatal blood tests
Haemoglobin 10.1 g/dL 11.0 - 15.0
Fasting Blood Sugar 96 mg/dL 70 - 100
TSH 3.1 uIU/mL 0.4 - 4.5`;

export interface TourStep {
  id: string;
  /** What the patient taps. */
  label: string;
  /** What it shows off, in one line. */
  why: string;
  send?: string;
  attach?: boolean;
  /** Completed once the conversation shows this. */
  done: (m: ChatMessage[]) => boolean;
}

const ai = (m: ChatMessage[], re: RegExp) => m.some((x) => x.role !== 'customer' && re.test(x.content));
const said = (m: ChatMessage[], re: RegExp) => m.some((x) => x.role === 'customer' && re.test(x.content));

/** The guided patient journey: book → name → report → a clinical question. */
export const patientSteps: TourStep[] = [
  { id: 'book', label: 'Book Dr. Narmadha tomorrow', why: 'Understands the doctor and the day, offers real free slots.', send: 'Book Dr. Narmadha tomorrow', done: (m) => ai(m, /Reply with a number|எண்ணை/) },
  { id: 'slot', label: '1', why: 'Picks the first slot. No forms.', send: '1', done: (m) => ai(m, /full name|பெயர்|✅/) },
  { id: 'name', label: 'Priya Raman', why: 'Books it: token number and a live visit page.', send: 'Priya Raman', done: (m) => ai(m, /✅/) },
  { id: 'report', label: '📎 Send my blood report', why: 'The report goes to the doctor’s review queue before the visit.', attach: true, done: (m) => said(m, /^Attached report/) },
  { id: 'safety', label: 'Can I stop my BP tablet?', why: 'Never gives medical advice: hands it to the clinical team.', send: 'Can I stop my BP tablet?', done: (m) => said(m, /stop my BP tablet/i) && ai(m, /medical advice|clinical team|மருத்துவ ஆலோசனை/) },
];

export function currentStep(steps: TourStep[], messages: ChatMessage[]): number {
  const i = steps.findIndex((s) => !s.done(messages));
  return i === -1 ? steps.length : i;
}

/** The visit page link from the booking confirmation, as an in-app path. */
export function visitPath(messages: ChatMessage[]): string | null {
  for (const m of messages) {
    const code = m.content.match(/\/v\/([A-Za-z0-9]{4,12})/)?.[1];
    if (code) return `/v/${code}`;
  }
  return null;
}
