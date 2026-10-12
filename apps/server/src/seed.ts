import { config } from './config.ts';
import { ctx } from './ctx.ts';
import { hashPassword, token, uuid } from './lib/crypto.ts';
import { ingestSource } from './jobs/ingest.ts';
import { createOrg, getOrg, type Org } from './services/orgs.ts';
import { addMessage, createConversation, resolve, runAi, setStatus } from './services/conversations.ts';
import { dayBounds, findOrCreateClient, fromLocal, localParts, refreshEtas, type Staff } from './services/visits.ts';
import { processRecord } from './services/records.ts';

/**
 * Demo workspace: a FICTIONAL multispeciality hospital in Chennai. Every name, number and report
 * below is synthetic. Nothing here is real patient data.
 */
export const DEMO_ORG_NAME = 'Poonthalir Hospital';
const LEGACY_DEMO_NAMES = ['Kaapi & Co.', 'Poonthalir Multispeciality Hospital'];

const faqEnglish = `# Poonthalir Hospital, Anna Nagar, Chennai: Patient Help Desk

## Timings
Q: What are the OPD (outpatient) timings?
A: Outpatient clinics run Monday to Saturday, 8:00 AM to 8:00 PM, and Sunday 9:00 AM to 1:00 PM. Emergency and pharmacy are open 24 hours, all 7 days.

Q: What are the visiting hours for admitted patients?
A: Visiting hours are 11:00 AM to 12:00 PM and 4:00 PM to 7:00 PM. Only one attender may stay with the patient overnight. ICU visits are limited to 10 minutes, twice a day.

## Appointments
Q: How do I book an appointment?
A: Say "book appointment" here on WhatsApp or chat, choose the doctor and a time, and you get a token number and a visit link. You can also call the front desk at 044-4000-1000 (demo number).

Q: What should I bring to my appointment?
A: Bring a photo ID, your previous prescriptions and reports, a list of the medicines you take, and your insurance card if you have one. Arrive 15 minutes early and check in from your visit link or the QR code at reception.

Q: How long will I wait at the hospital?
A: Check in when you arrive and you will see your token and a live estimated waiting time on your visit page and on WhatsApp. We update you if the doctor is running late.

## Fees and payments
Q: What is the consultation fee?
A: General medicine consultation is ₹500 and specialist consultation is ₹700. A review visit within 7 days with the same doctor is free.

Q: Which payment methods do you accept?
A: UPI (GPay, PhonePe, Paytm), debit and credit cards, net banking and cash.

## Insurance
Q: Do you accept health insurance and cashless treatment?
A: Yes. We offer cashless treatment with most major health insurers and TPAs. Bring your insurance card and photo ID to the insurance desk on the ground floor; pre-authorisation for planned admissions takes 4 to 24 hours.

## Laboratory and scans
Q: What are the lab timings?
A: The laboratory is open 7:00 AM to 9:00 PM every day. Fasting samples are collected from 7:00 AM.

Q: When will my lab report be ready?
A: Routine blood test reports are ready the same evening and are sent to you on WhatsApp. Culture reports take 48 to 72 hours. Ask me with your lab ID (for example LAB-2041) to check the status.

Q: Do you collect samples from home?
A: Yes, home sample collection is available in Anna Nagar, Kilpauk, Aminjikarai, Mogappair and Koyambedu for ₹150. Book it a day in advance.

## Facilities
Q: Is parking available?
A: Yes, free parking is available in the basement. Wheelchairs are available at the main entrance.

Q: How do I get a copy of my medical records?
A: Request it at the Medical Records desk with a photo ID. Copies are ready in 2 working days. Discharge summaries are shared on WhatsApp at discharge.

## Emergency
Q: What should I do in an emergency?
A: Call 108 for an ambulance or come directly to our 24-hour Emergency department. Our emergency line is 044-4000-1111 (demo number).
`;

const faqTamil = `# நோயாளி உதவி மையம் (தமிழ்)

கேள்வி: வெளிநோயாளர் பிரிவு நேரம் என்ன?
பதில்: வெளிநோயாளர் பிரிவு திங்கள் முதல் சனி வரை காலை 8 மணி முதல் இரவு 8 மணி வரை, ஞாயிறு காலை 9 முதல் மதியம் 1 மணி வரை செயல்படும். அவசர சிகிச்சைப் பிரிவும் மருந்தகமும் 24 மணி நேரமும் திறந்திருக்கும்.

கேள்வி: ஆலோசனைக் கட்டணம் எவ்வளவு?
பதில்: பொது மருத்துவ ஆலோசனைக்கு ₹500, சிறப்பு மருத்துவர் ஆலோசனைக்கு ₹700. அதே மருத்துவரிடம் 7 நாட்களுக்குள் மறுபரிசோதனை இலவசம்.

கேள்வி: காப்பீடு மற்றும் பணமில்லா சிகிச்சை உள்ளதா?
பதில்: ஆம். பெரும்பாலான முக்கிய காப்பீட்டு நிறுவனங்களுடன் பணமில்லா சிகிச்சை உள்ளது. உங்கள் காப்பீட்டு அட்டை மற்றும் அடையாள அட்டையைத் தரைத்தளத்தில் உள்ள காப்பீட்டு மேசைக்குக் கொண்டு வரவும்.

கேள்வி: பரிசோதனை அறிக்கை எப்போது கிடைக்கும்?
பதில்: வழக்கமான ரத்தப் பரிசோதனை அறிக்கைகள் அதே மாலை வாட்ஸ்அப்பில் அனுப்பப்படும். கல்ச்சர் அறிக்கைகளுக்கு 48 முதல் 72 மணி நேரம் ஆகும்.

கேள்வி: பரிசோதனைக் கூட நேரம் என்ன?
பதில்: பரிசோதனைக் கூடம் தினமும் காலை 7 மணி முதல் இரவு 9 மணி வரை திறந்திருக்கும். வெறும் வயிற்று மாதிரிகள் காலை 7 மணி முதல் சேகரிக்கப்படும்.

கேள்வி: வீட்டிற்கு வந்து மாதிரி சேகரிப்பீர்களா?
பதில்: ஆம், அண்ணா நகர், கீழ்ப்பாக்கம், அமைந்தகரை, முகப்பேர், கோயம்பேடு பகுதிகளில் ₹150 கட்டணத்தில் வீட்டிலேயே மாதிரி சேகரிப்பு உண்டு. ஒரு நாள் முன்பே பதிவு செய்யவும்.

கேள்வி: பார்வையாளர் நேரம் என்ன?
பதில்: பார்வையாளர் நேரம் காலை 11 முதல் 12 மணி வரை மற்றும் மாலை 4 முதல் 7 மணி வரை.

கேள்வி: வாகன நிறுத்தம் உள்ளதா?
பதில்: ஆம், அடித்தளத்தில் இலவச வாகன நிறுத்தம் உள்ளது. முதன்மை நுழைவாயிலில் சக்கர நாற்காலிகள் கிடைக்கும்.

கேள்வி: சந்திப்புக்கு என்ன கொண்டு வர வேண்டும்?
பதில்: அடையாள அட்டை, பழைய மருந்துச் சீட்டுகள், பரிசோதனை அறிக்கைகள், நீங்கள் எடுக்கும் மருந்துகளின் பட்டியல் மற்றும் காப்பீட்டு அட்டையைக் கொண்டு வரவும். 15 நிமிடங்கள் முன்னதாக வந்து செக்-இன் செய்யவும்.
`;

const faqHindi = `# सहायता केंद्र (हिंदी)

प्रश्न: ओपीडी का समय क्या है?
उत्तर: ओपीडी सोमवार से शनिवार सुबह 8 बजे से रात 8 बजे तक और रविवार सुबह 9 से दोपहर 1 बजे तक चलती है। इमरजेंसी और फार्मेसी 24 घंटे खुली रहती हैं।

प्रश्न: परामर्श शुल्क कितना है?
उत्तर: जनरल मेडिसिन परामर्श ₹500 और विशेषज्ञ परामर्श ₹700 है। उसी डॉक्टर से 7 दिनों के अंदर दोबारा दिखाना मुफ्त है।

प्रश्न: क्या कैशलेस इलाज होता है?
उत्तर: हाँ, अधिकांश प्रमुख बीमा कंपनियों और टीपीए के साथ कैशलेस इलाज उपलब्ध है। अपना बीमा कार्ड और फोटो आईडी साथ लाएँ।
`;

const doctors: { name: string; specialty: string; languages: string[]; avg: number }[] = [
  { name: 'Dr. Meenakshi Sundaram', specialty: 'General Medicine', languages: ['ta', 'en'], avg: 12 },
  { name: 'Dr. Arjun Ramanathan', specialty: 'Cardiology', languages: ['ta', 'en', 'hi'], avg: 18 },
  { name: 'Dr. Lakshmi Narayanan', specialty: 'Diabetology & Endocrinology', languages: ['ta', 'en'], avg: 15 },
  { name: 'Dr. Kavitha Selvaraj', specialty: 'Paediatrics', languages: ['ta', 'en', 'te'], avg: 12 },
  { name: 'Dr. Farhan Ali', specialty: 'Orthopaedics', languages: ['en', 'hi', 'ta'], avg: 15 },
  { name: 'Dr. Narmadha Vasu', specialty: 'Obstetrics & Gynaecology', languages: ['ta', 'en'], avg: 15 },
  { name: 'Dr. Kannan', specialty: 'Anaesthesiology (pre-anaesthetic check-up)', languages: ['ta', 'en'], avg: 20 },
];

const protocols: { title: string; keywords: string[]; instructions: string; days: number }[] = [
  {
    title: 'Fasting blood tests / வெறும் வயிற்றில் ரத்தப் பரிசோதனை',
    keywords: ['diabet', 'endocrin', 'sugar', 'thyroid', 'lipid', 'cholesterol', 'fasting'],
    days: 1,
    instructions:
      'Do not eat or drink anything except plain water for 10–12 hours before your visit. Take your usual blood-pressure and thyroid tablets with water unless your doctor told you otherwise. Do not stop any medicine on your own. Bring your glucometer readings and all previous reports.\n' +
      'வருகைக்கு 10–12 மணி நேரத்திற்கு முன் தண்ணீர் தவிர எதுவும் சாப்பிட வேண்டாம். மருத்துவர் வேறு சொல்லாவிட்டால் வழக்கமான பிபி, தைராய்டு மாத்திரைகளைத் தண்ணீருடன் எடுக்கவும். எந்த மருந்தையும் நீங்களாக நிறுத்த வேண்டாம். குளுக்கோமீட்டர் அளவீடுகளையும் பழைய அறிக்கைகளையும் கொண்டு வரவும்.',
  },
  {
    title: 'Cardiology visit / இதய நல ஆலோசனை',
    keywords: ['cardio', 'heart', 'chest', 'bp'],
    days: 1,
    instructions:
      'Bring all previous ECGs, echo and angiogram reports, and your current medicines in their strips. Avoid coffee or tea for 4 hours before the visit. Wear loose clothing for an ECG.\n' +
      'பழைய ஈசிஜி, எக்கோ, ஆஞ்சியோகிராம் அறிக்கைகள் மற்றும் தற்போதைய மருந்துகளைக் கொண்டு வரவும். வருகைக்கு 4 மணி நேரத்திற்கு முன் காபி, டீ தவிர்க்கவும். ஈசிஜிக்காகத் தளர்வான உடை அணியவும்.',
  },
  {
    title: "Child's visit / குழந்தைகள் நல ஆலோசனை",
    keywords: ['paedi', 'child', 'baby', 'vaccin'],
    days: 1,
    instructions:
      "Bring your child's vaccination card, birth weight and growth records, and any previous prescriptions. Note the child's temperature readings if there is fever.\n" +
      'குழந்தையின் தடுப்பூசி அட்டை, பிறப்பு எடை, வளர்ச்சிப் பதிவுகள், பழைய மருந்துச் சீட்டுகளைக் கொண்டு வரவும். காய்ச்சல் இருந்தால் வெப்பநிலை அளவீடுகளைக் குறித்துக் கொள்ளவும்.',
  },
  {
    title: 'Pre-anaesthetic check-up / மயக்க மருந்துக்கு முந்தைய பரிசோதனை',
    keywords: ['anaesth', 'surgery', 'procedure', 'pre-op', 'operation'],
    days: 1,
    instructions:
      'Bring all reports, your list of current medicines and any previous anaesthesia or surgery records. Tell the doctor about allergies, blood thinners, diabetes or heart problems. Fasting instructions for the day of surgery will be given by Dr. Kannan at this check-up; do not stop any medicine on your own.\n' +
      'அனைத்து அறிக்கைகள், தற்போதைய மருந்துகளின் பட்டியல், முந்தைய அறுவை சிகிச்சை / மயக்க மருந்து பதிவுகளைக் கொண்டு வரவும். ஒவ்வாமை, ரத்தம் உறையாமல் தடுக்கும் மருந்துகள், சர்க்கரை நோய், இதய பிரச்சனைகள் இருந்தால் தெரிவிக்கவும். அறுவை சிகிச்சை நாளுக்கான உண்ணாவிரத வழிமுறைகளை டாக்டர் கண்ணன் இந்தப் பரிசோதனையில் வழங்குவார். எந்த மருந்தையும் நீங்களாக நிறுத்த வேண்டாம்.',
  },
  {
    title: 'Orthopaedics visit / எலும்பு மூட்டு ஆலோசனை',
    keywords: ['ortho', 'bone', 'joint', 'knee', 'back'],
    days: 1,
    instructions: 'Bring your X-ray and MRI films (not only the reports) and wear loose clothing so the joint can be examined.\nஎக்ஸ்-ரே, எம்ஆர்ஐ படங்களை (அறிக்கை மட்டுமல்ல) கொண்டு வரவும். பரிசோதனைக்காகத் தளர்வான உடை அணியவும்.',
  },
];

/** Synthetic patients and lab reports. */
const patients: { name: string; phone: string; lang: string; birthYear: number; sex: 'F' | 'M'; doctor: number; reason: string; records: { title: string; daysAgo: number; text: string }[] }[] = [
  {
    name: 'Lakshmi Raman', phone: '9000000101', lang: 'ta', birthYear: 1963, sex: 'F', doctor: 2, reason: 'Diabetes review',
    records: [
      { title: 'Lab report (Feb)', daysAgo: 240, text: 'SYNTHETIC REPORT\nPatient: Lakshmi Raman\nDate: {date}\nHbA1c 7.1 % 4.0 - 5.6\nFasting Blood Sugar 132 mg/dL 70 - 100\nSerum Creatinine 0.9 mg/dL 0.6 - 1.2\n' },
      { title: 'Lab report (latest)', daysAgo: 6, text: 'SYNTHETIC REPORT\nPatient: Lakshmi Raman\nDate: {date}\nHbA1c 8.4 % 4.0 - 5.6\nFasting Blood Sugar 168 mg/dL 70 - 100\nPost Prandial Blood Sugar 246 mg/dL 70 - 140\nLDL Cholesterol 142 mg/dL 0 - 100\nHDL Cholesterol 44 mg/dL\nTriglycerides 190 mg/dL 0 - 150\nSerum Creatinine 1.1 mg/dL 0.6 - 1.2\n' },
      { title: 'Prescription', daysAgo: 240, text: 'Rx\nTab. Metformin 500 mg 1-0-1 after food\nTab. Glimepiride 1 mg 1-0-0 before breakfast\nBP: 138/86\n' },
    ],
  },
  {
    name: 'Murugan Pillai', phone: '9000000102', lang: 'ta', birthYear: 1969, sex: 'M', doctor: 0, reason: 'Weakness, review of kidney tests',
    records: [{ title: 'Renal function test', daysAgo: 1, text: 'SYNTHETIC REPORT\nDate: {date}\nSerum Creatinine 2.4 mg/dL 0.7 - 1.3\nBlood Urea 78 mg/dL 15 - 45\nSodium 133 mmol/L 135 - 145\nPotassium 6.8 mmol/L 3.5 - 5.1\n' }],
  },
  {
    name: 'Fathima Begum', phone: '9000000103', lang: 'en', birthYear: 1991, sex: 'F', doctor: 0, reason: 'Tiredness',
    records: [{ title: 'CBC and vitamins', daysAgo: 3, text: 'SYNTHETIC REPORT\nDate: {date}\nHaemoglobin 9.1 g/dL 12.0 - 15.5\nTotal WBC Count 7.2 x10^3/uL 4.0 - 11.0\nPlatelet Count 2.6 lakhs/uL 1.5 - 4.5\nVitamin D (25-OH) 14 ng/mL 30 - 100\nVitamin B12 310 pg/mL 200 - 900\n' }],
  },
  {
    name: 'Senthil Nathan', phone: '9000000104', lang: 'ta', birthYear: 1978, sex: 'M', doctor: 1, reason: 'BP and chest discomfort on exertion',
    records: [
      { title: 'Lipid profile', daysAgo: 20, text: 'SYNTHETIC REPORT\nDate: {date}\nTotal Cholesterol 236 mg/dL < 200\nLDL Cholesterol 162 mg/dL < 100\nHDL Cholesterol 36 mg/dL > 40\nTriglycerides 210 mg/dL < 150\n' },
      { title: 'Clinic note', daysAgo: 20, text: 'BP: 152/96\nTab. Telmisartan 40 mg 1-0-0\nAdvised: ECG, Echo\n' },
    ],
  },
  {
    name: 'Revathi Subramanian', phone: '9000000105', lang: 'ta', birthYear: 1980, sex: 'F', doctor: 2, reason: 'Thyroid follow-up',
    records: [{ title: 'Thyroid profile', daysAgo: 150, text: 'SYNTHETIC REPORT\nDate: {date}\nTSH 8.9 uIU/mL 0.4 - 4.5\n' }],
  },
  { name: 'Arun Kumar (age 7)', phone: '9000000106', lang: 'ta', birthYear: 2019, sex: 'M', doctor: 3, reason: 'Fever for 2 days', records: [] },
  { name: 'Joseph Xavier', phone: '9000000107', lang: 'en', birthYear: 1955, sex: 'M', doctor: 4, reason: 'Knee pain', records: [] },
  { name: 'Ananya Krishnan', phone: '9000000108', lang: 'en', birthYear: 1997, sex: 'F', doctor: 5, reason: 'Antenatal check-up', records: [] },
  { name: 'Mohan Das', phone: '9000000113', lang: 'ta', birthYear: 1966, sex: 'M', doctor: 6, reason: 'Pre-anaesthetic check-up before knee surgery', records: [] },
  { name: 'Karthik Raja', phone: '9000000109', lang: 'ta', birthYear: 1986, sex: 'M', doctor: 0, reason: 'Cough and cold', records: [] },
  { name: 'Selvi Murthy', phone: '9000000110', lang: 'ta', birthYear: 1972, sex: 'F', doctor: 0, reason: 'Headache', records: [] },
  { name: 'Ravi Shankar', phone: '9000000111', lang: 'hi', birthYear: 1983, sex: 'M', doctor: 0, reason: 'Body pain', records: [] },
  { name: 'Deepa Anand', phone: '9000000112', lang: 'en', birthYear: 1990, sex: 'F', doctor: 1, reason: 'Palpitations', records: [] },
];

const sampleChats: { q: string; outcome: 'resolved' | 'open' | 'idle'; daysAgo: number; name?: string }[] = [
  { q: 'What are the OPD timings?', outcome: 'resolved', daysAgo: 12, name: 'Ganesh' },
  { q: 'வெளிநோயாளர் பிரிவு நேரம் என்ன?', outcome: 'resolved', daysAgo: 11, name: 'Kamala' },
  { q: 'Do you accept health insurance and cashless treatment?', outcome: 'resolved', daysAgo: 10 },
  { q: 'ஆலோசனைக் கட்டணம் எவ்வளவு?', outcome: 'resolved', daysAgo: 9, name: 'Saravanan' },
  { q: 'When will my lab report be ready?', outcome: 'resolved', daysAgo: 8 },
  { q: 'Is my lab report LAB-2041 ready?', outcome: 'resolved', daysAgo: 7 },
  { q: 'வீட்டிற்கு வந்து மாதிரி சேகரிப்பீர்களா?', outcome: 'resolved', daysAgo: 6, name: 'Meena' },
  { q: 'Is parking available?', outcome: 'resolved', daysAgo: 5 },
  { q: 'Can I take paracetamol with my BP tablets?', outcome: 'open', daysAgo: 2, name: 'Vijay' },
  { q: 'My father has chest pain and is sweating', outcome: 'open', daysAgo: 1, name: 'Anitha' },
  { q: 'परामर्श शुल्क कितना है?', outcome: 'idle', daysAgo: 0 },
];

const MIN = 60_000;

/** Keep the demo alive: today's queue exists and moves on its own (patients arrive, consultations end). */
export async function refreshDemoDay(): Promise<void> {
  const org = await demoOrg();
  if (!org) return;
  const off = org.settings.utcOffsetMin;
  const now = new Date();
  const { start, end } = dayBounds(now, off);
  const staff = await ctx.db.query<Staff>('select * from staff_members where org_id = $1 order by name', [org.id]);
  const gp = staff.find((s) => s.specialty === 'General Medicine');
  if (!gp) return;
  const today = await ctx.db.one<{ c: number }>(`select count(*)::int as c from appointments where staff_id = $1 and starts_at >= $2 and starts_at < $3`, [gp.id, start, end]);
  if ((today?.c ?? 0) === 0) await seedTodaysQueue(org, staff, now);
  await advanceDemoQueue(org, staff, now);
}

async function seedTodaysQueue(org: Org, staff: Staff[], now: Date) {
  const off = org.settings.utcOffsetMin;
  const p = localParts(now, off);
  // Anchor the session around "now", but keep it inside today in local time.
  const dayStart = fromLocal(p.y, p.m, p.d, 0, 15, off).getTime();
  const anchor = Math.max(dayStart + 90 * MIN, Math.min(now.getTime(), fromLocal(p.y, p.m, p.d, 22, 0, off).getTime()));
  const clients = await ctx.db.query<{ id: string; name: string }>('select id, name from clients where org_id = $1 order by created_at', [org.id]);
  const byName = (n: string) => clients.find((c) => c.name === n)!;
  const plan: { who: string; staff: number; offsetMin: number; status: string }[] = [
    { who: 'Karthik Raja', staff: 0, offsetMin: -75, status: 'done' },
    { who: 'Selvi Murthy', staff: 0, offsetMin: -60, status: 'done' },
    { who: 'Murugan Pillai', staff: 0, offsetMin: -45, status: 'in_progress' },
    { who: 'Fathima Begum', staff: 0, offsetMin: -30, status: 'checked_in' },
    { who: 'Ravi Shankar', staff: 0, offsetMin: -15, status: 'checked_in' },
    { who: 'Joseph Xavier', staff: 4, offsetMin: -20, status: 'checked_in' },
    { who: 'Lakshmi Raman', staff: 2, offsetMin: 20, status: 'booked' },
    { who: 'Senthil Nathan', staff: 1, offsetMin: -10, status: 'checked_in' },
    { who: 'Deepa Anand', staff: 1, offsetMin: 25, status: 'booked' },
    { who: 'Arun Kumar (age 7)', staff: 3, offsetMin: 40, status: 'booked' },
    { who: 'Ananya Krishnan', staff: 5, offsetMin: 60, status: 'booked' },
    { who: 'Revathi Subramanian', staff: 2, offsetMin: 50, status: 'booked' },
    { who: 'Mohan Das', staff: 6, offsetMin: -5, status: 'checked_in' },
  ];
  const tokens = new Map<string, number>();
  const ordered = [...plan].sort((a, b) => a.offsetMin - b.offsetMin);
  const spec = (i: number) => staff.find((s) => s.specialty === doctors[i]!.specialty)!;
  for (const a of ordered) {
    const s = spec(a.staff);
    const c = byName(a.who);
    if (!s || !c) continue;
    const startsAt = new Date(anchor + a.offsetMin * MIN);
    const tok = (tokens.get(s.id) ?? 0) + 1;
    tokens.set(s.id, tok);
    const started = a.status === 'done' ? new Date(startsAt.getTime() + 2 * MIN) : a.status === 'in_progress' ? new Date(now.getTime() - 5 * MIN) : null;
    const ended = a.status === 'done' ? new Date(started!.getTime() + (s.avg_minutes + (tok % 3) - 1) * MIN) : null;
    const checked = a.status === 'booked' ? null : new Date(startsAt.getTime() - 8 * MIN);
    const patient = patients.find((x) => x.name === a.who);
    await ctx.db.query(
      `insert into appointments (id, org_id, client_id, staff_id, starts_at, status, reason, channel, token_no, code, checked_in_at, checkin_method, started_at, ended_at)
       values ($1, $2, $3, $4, $5, $6, $7, 'chat', $8, $9, $10, $11, $12, $13)`,
      [uuid(), org.id, c.id, s.id, startsAt, a.status, patient?.reason ?? '', tok, token(6).replace(/[^A-Za-z0-9]/g, 'x').toUpperCase(), checked, checked ? (tok % 2 ? 'qr' : 'whatsapp') : null, started, ended],
    );
  }
  for (const s of staff) await refreshEtas(org, s.id);
}

/** Every tick: finish consultations that ran their course, call the next token, and let booked patients arrive. */
async function advanceDemoQueue(org: Org, staff: Staff[], now: Date) {
  const { start, end } = dayBounds(now, org.settings.utcOffsetMin);
  let changed = false;
  for (const s of staff) {
    const cur = await ctx.db.one<{ id: string; started_at: Date }>(`select id, started_at from appointments where staff_id = $1 and status = 'in_progress' and starts_at >= $2 and starts_at < $3`, [s.id, start, end]);
    if (cur && now.getTime() - new Date(cur.started_at).getTime() > (s.avg_minutes + 3) * MIN) {
      await ctx.db.query(`update appointments set status = 'done', ended_at = now() where id = $1`, [cur.id]);
      changed = true;
    }
    if (!cur || changed) {
      const next = await ctx.db.one<{ id: string }>(`select id from appointments where staff_id = $1 and status = 'checked_in' and starts_at >= $2 and starts_at < $3 order by token_no limit 1`, [s.id, start, end]);
      const busy = await ctx.db.one(`select 1 from appointments where staff_id = $1 and status = 'in_progress' and starts_at >= $2 and starts_at < $3`, [s.id, start, end]);
      if (next && !busy) {
        await ctx.db.query(`update appointments set status = 'in_progress', started_at = now() where id = $1`, [next.id]);
        changed = true;
      }
    }
    // Synthetic patients arrive ~10 minutes before their slot.
    const arriving = await ctx.db.query<{ id: string }>(
      `update appointments a set status = 'checked_in', checked_in_at = now(), checkin_method = 'qr'
        from clients c where c.id = a.client_id and c.phone like '90000001%' and a.staff_id = $1 and a.status = 'booked' and a.starts_at between $2 and $3 returning a.id`,
      [s.id, start, new Date(now.getTime() + 10 * MIN)],
    );
    if (arriving.length || changed) await refreshEtas(org, s.id);
  }
}

async function demoOrg(): Promise<Org | undefined> {
  const row = await ctx.db.one<{ id: string }>('select id from orgs where name = $1 order by created_at limit 1', [DEMO_ORG_NAME]);
  return row ? getOrg(row.id) : undefined;
}

export async function seedDemo(): Promise<void> {
  if (!config.demo.seed) return;
  let user = await ctx.db.one<{ id: string }>('select id from users where email = $1', [config.demo.email]);
  if (user && (await demoOrg())) return refreshDemoDay();
  console.log('[seed] creating demo workspace…');

  if (user) {
    // Replace the previous demo (an online store) with the hospital demo.
    await ctx.db.query(`delete from orgs where name in (select jsonb_array_elements_text($1::jsonb)) and id in (select org_id from members where user_id = $2)`, [LEGACY_DEMO_NAMES, user.id]);
  } else {
    const id = uuid();
    await ctx.db.query('insert into users (id, email, name, password_hash) values ($1, $2, $3, $4)', [id, config.demo.email, 'Demo Owner', await hashPassword(config.demo.password)]);
    user = { id };
  }
  const userId = user.id;
  const created = await createOrg(DEMO_ORG_NAME, userId, {
    botName: 'Poonthalir Assistant',
    brandColor: '#0f766e',
    greeting: 'வணக்கம்! 🙏 Ask me about appointments, timings, fees, insurance or lab reports — in தமிழ், English or हिंदी. Say "book appointment" to see a doctor.',
    confidenceThreshold: 0.45,
    vertical: 'healthcare',
    emergencyNumber: '108',
    utcOffsetMin: 330,
    voice: { provider: 'simulated' },
  });
  await ctx.db.query(`update orgs set plan = 'institution' where id = $1`, [created.id]);
  // Add-ons are active in the demo so visitors can see them.
  await ctx.db.query(`insert into addons (org_id, addon, status) values ($1, 'telecalling', 'active'), ($1, 'camera_checkin', 'active') on conflict do nothing`, [created.id]);
  const org = (await getOrg(created.id))!;

  for (const [title, content] of [['Patient Help Desk (English)', faqEnglish], ['நோயாளி உதவி மையம் (தமிழ்)', faqTamil], ['सहायता केंद्र (हिंदी)', faqHindi]] as const) {
    const id = uuid();
    await ctx.db.query(`insert into knowledge_sources (id, org_id, type, title, content) values ($1, $2, 'faq', $3, $4)`, [id, org.id, title, content]);
    await ingestSource({ sourceId: id });
  }

  // Doctors: the demo keeps long hours, every day, so a visitor always finds slots and a live queue.
  const staffIds: string[] = [];
  for (const d of doctors) {
    const id = uuid();
    staffIds.push(id);
    await ctx.db.query(
      `insert into staff_members (id, org_id, name, specialty, languages, avg_minutes, schedule) values ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb)`,
      [id, org.id, d.name, d.specialty, d.languages, d.avg, { days: [0, 1, 2, 3, 4, 5, 6], start: '08:00', end: '21:00' }],
    );
  }
  for (const p of protocols) {
    await ctx.db.query(`insert into prep_protocols (id, org_id, title, keywords, instructions, days_before, approved_by) values ($1, $2, $3, $4::jsonb, $5, $6, $7)`, [
      uuid(), org.id, p.title, p.keywords, p.instructions, p.days, 'Dr. Meenakshi Sundaram (Medical Director)',
    ]);
  }

  // Lab report status Action (mock hospital LIS), plus a sensitive one that needs staff verification.
  const lis = `${config.publicUrl}/demo-api`;
  await ctx.db.query(
    `insert into actions (id, org_id, name, description, keywords, method, url, params, response_template, sensitive) values
     ($1, $2, 'Lab report status', 'Look up whether a lab report is ready, by its lab ID.', $3::jsonb, 'GET', $4, $5::jsonb, $6, false),
     ($7, $2, 'Cancel home sample collection', 'Cancel a booked home sample collection. Requires staff verification.', $8::jsonb, 'POST', $9, $5::jsonb, $10, true)`,
    [
      uuid(), org.id,
      ['lab', 'report', 'result', 'ready', 'அறிக்கை', 'ரிப்போர்ட்', 'रिपोर्ट'],
      `${lis}/lab/{lab_id}`,
      [{ name: 'lab_id', description: 'lab ID (like LAB-2041)', required: true, pattern: '(LAB-?\\d{3,6})' }],
      'Report {{id}} ({{test}}): {{status}}. {{note}}',
      uuid(),
      ['cancel collection', 'cancel home collection', 'cancel sample', 'ரத்து'],
      `${lis}/lab/{lab_id}/cancel`,
      'Home collection for {{id}} has been cancelled.',
    ],
  );

  // Synthetic patients, their reports (processed by the intake + findings agents) and history.
  for (const p of patients) {
    const client = await findOrCreateClient(org, { name: p.name, phone: p.phone, lang: p.lang });
    await ctx.db.query('update clients set birth_year = $2, sex = $3 where id = $1', [client.id, p.birthYear, p.sex]);
    if (p.name === 'Lakshmi Raman') {
      const due = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
      await ctx.db.query(
        `insert into investigations (id, org_id, client_id, test, label, instructions, due_by, status, ordered_by, created_at) values ($1, $2, $3, 'ldl', 'Lipid profile', 'Fasting 10–12 hours.', $4, 'ordered', 'Dr. Lakshmi Narayanan', now() - interval '3 days')`,
        [uuid(), org.id, client.id, due],
      );
    }
    for (const r of p.records) {
      const d = new Date(Date.now() - r.daysAgo * 86400_000);
      const date = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
      const id = uuid();
      await ctx.db.query(`insert into records (id, org_id, client_id, title, text, uploaded_by, created_at) values ($1, $2, $3, $4, $5, 'staff', $6)`, [
        id, org.id, client.id, r.title, r.text.replace('{date}', date), d,
      ]);
      await processRecord({ recordId: id });
    }
  }
  // Past visits with ratings (synthetic) so staff ratings and visit history are not empty.
  const roster = await ctx.db.query<{ id: string; avg_minutes: number }>('select id, avg_minutes from staff_members where org_id = $1 order by name', [org.id]);
  const people = await ctx.db.query<{ id: string }>('select id from clients where org_id = $1 order by created_at', [org.id]);
  const comments = ['Doctor explained everything clearly', 'Short wait, reminder on WhatsApp helped', 'மருத்துவர் பொறுமையாக விளக்கினார்', 'Had to wait longer than the estimate', 'Very kind with my child', ''];
  for (let i = 0; i < 24; i++) {
    const s = roster[i % roster.length]!;
    const p = people[(i * 5) % people.length]!;
    const startsAt = new Date(Date.now() - (2 + (i % 13)) * 86400_000 - (i % 5) * 3600_000);
    const apptId = uuid();
    await ctx.db.query(
      `insert into appointments (id, org_id, client_id, staff_id, starts_at, status, reason, channel, token_no, code, checked_in_at, checkin_method, started_at, ended_at)
       values ($1, $2, $3, $4, $5, 'done', 'Consultation', 'chat', $6, $7, $5, 'qr', $5::timestamptz + interval '6 minutes', $5::timestamptz + make_interval(mins => $8))`,
      [apptId, org.id, p.id, s.id, startsAt, (i % 9) + 1, token(6).replace(/[^A-Za-z0-9]/g, 'x').toUpperCase(), 6 + s.avg_minutes + (i % 4) - 1],
    );
    const rating = [5, 5, 4, 5, 3, 4, 5, 2][i % 8]!;
    await ctx.db.query(`insert into visit_ratings (id, org_id, appointment_id, client_id, staff_id, rating, ai_rating, comment, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
      uuid(), org.id, apptId, p.id, s.id, rating, Math.min(5, rating + (i % 2)), comments[i % comments.length], new Date(startsAt.getTime() + 3600_000),
    ]);
  }

  // Simulated telecalls and follow-ups so the add-on screens are not empty.
  const someone = await ctx.db.query<{ id: string; name: string }>(`select id, name from clients where org_id = $1 order by created_at limit 3`, [org.id]);
  const outcomes: [string, string][] = [['reminder', 'confirmed'], ['followup', 'better'], ['reminder', 'reschedule']];
  for (const [i, c] of someone.entries()) {
    const [purpose, outcome] = outcomes[i]!;
    await ctx.db.query(
      `insert into calls (id, org_id, client_id, direction, purpose, provider, to_number, status, outcome, transcript, created_at) values ($1, $2, $3, 'outbound', $4, 'simulated', '91900000010${i + 1}', 'completed', $5, $6::jsonb, now() - ($7 || ' hours')::interval)`,
      [uuid(), org.id, c.id, purpose, outcome, [{ who: 'relay', text: purpose === 'reminder' ? 'Appointment reminder (Tamil)' : 'How are you feeling since your visit?' }, { who: 'callee', text: `pressed ${outcome === 'confirmed' || outcome === 'better' ? 1 : 2}` }], String(5 + i * 7)],
    );
  }

  // Sample conversations so the inbox and analytics are not empty.
  for (const chat of sampleChats) {
    const conv = await createConversation(org, `v_demo_${uuid().slice(0, 8)}`, 'web', { name: chat.name });
    await addMessage(conv, 'customer', chat.q);
    const out = await runAi(org, conv, chat.q);
    if (chat.outcome === 'resolved' && out.kind !== 'handoff') await resolve(conv, 'ai', chat.daysAgo % 3 === 0 ? 4 : 5);
    if (chat.outcome === 'open' && out.kind !== 'handoff') await setStatus(conv, 'escalated');
    const shift = `${chat.daysAgo} days`;
    await ctx.db.query(
      `update conversations set created_at = created_at - $2::interval, last_message_at = last_message_at - $2::interval, resolved_at = resolved_at - $2::interval where id = $1`,
      [conv.id, shift],
    );
    await ctx.db.query(`update messages set created_at = created_at - $2::interval where conversation_id = $1`, [conv.id, shift]);
  }
  void staffIds;
  await refreshDemoDay();
  console.log(`[seed] demo workspace ready (${DEMO_ORG_NAME})`);
}

export async function demoSiteKey(): Promise<string | null> {
  const row = await ctx.db.one<{ site_key: string }>('select site_key from orgs where name = $1 order by created_at limit 1', [DEMO_ORG_NAME]);
  return row?.site_key ?? null;
}
