import type { Me } from './session';

/** Institution-specific words, so one product reads naturally in a hospital, a coaching centre or a salon. */
export function terms(me: Me | null) {
  const v = me?.org.settings.vertical ?? 'general';
  if (v === 'healthcare') return { client: 'Patient', clients: 'Patients', staff: 'Doctor', staffs: 'Doctors', visit: 'Appointment', visits: 'Appointments', healthcare: true };
  if (v === 'education') return { client: 'Student', clients: 'Students', staff: 'Faculty', staffs: 'Faculty', visit: 'Session', visits: 'Sessions', healthcare: false };
  return { client: 'Client', clients: 'Clients', staff: 'Staff member', staffs: 'Staff', visit: 'Appointment', visits: 'Appointments', healthcare: false };
}

export function fmtTime(iso: string | Date) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}
export function fmtDate(iso: string | Date) {
  return new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}
export function fmtDateTime(iso: string | Date) {
  return `${fmtDate(iso)}, ${fmtTime(iso)}`;
}
export const langLabel: Record<string, string> = { en: 'English', ta: 'தமிழ்', hi: 'हिंदी', kn: 'ಕನ್ನಡ', te: 'తెలుగు', ml: 'മലയാളം' };
