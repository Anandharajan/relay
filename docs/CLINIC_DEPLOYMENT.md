# Relay for a clinic: deployment and doctor onboarding plan

How to put Relay in front of a real doctor or clinic: their own WhatsApp number, their own AI key (BYOK),
reminder and follow-up calls, and a safe way for the doctor to check everything the AI says before patients rely on it.

---

## 1. What the clinic gets

| For patients (WhatsApp, web chat, phone) | For the doctor and front desk (dashboard) |
|---|---|
| Answers about timings, fees, insurance, lab hours, in Tamil, English, Hindi and more | One inbox where AI and staff share every conversation |
| Booking with a token number and a live visit page | Live queue per doctor with waiting-time estimates |
| Doctor-approved preparation instructions before the visit | Doctor brief: reports read by the intake agent, results with trends, medicines |
| Report upload from the visit page | AI findings (critical, abnormal, worsening, overdue) for review |
| Live "you are 3rd, about 25 minutes" updates | Approvals: nothing clinical reaches a patient until a doctor approves it |
| Post-visit check-ins and review reminders | Investigations ordered → patient checklist → chased until the report arrives |
| Emergency replies with 108, and no medical advice from the AI, ever | Calls log (telecalling add-on), analytics, audit trail |

## 2. Accounts and what each costs

| Item | Who owns it | Needed for | Cost (check current rate cards) |
|---|---|---|---|
| Relay workspace | Clinic (you host it, or Relay Cloud) | Everything | Self-host free; cloud plans ₹0–₹9,999/month |
| Hosting | You | Always-on server | Render Starter ~US$7/month (the free tier sleeps and is **not** suitable for WhatsApp webhooks) |
| Database | You | Data | Aiven/Supabase free tier to start; paid tier for production backups |
| Meta Business account + WhatsApp Business Platform | **Clinic** | WhatsApp | Replies within 24 h of the patient's message are free; reminders/follow-ups outside that window use a paid **Utility template**, charged per delivered message in INR (Meta rate card) |
| A phone number for WhatsApp | Clinic | WhatsApp | The number cannot stay on the normal WhatsApp app at the same time |
| AI model key (BYOK) | **Clinic** | Better answers | Pay-as-you-go to the provider. Optional: the free extractive engine works with no key |
| Twilio account (optional) | Clinic | Reminder / follow-up calls | Calls to Indian mobiles ≈ US$0.05/minute on Twilio's rate card; plus the ₹1,999/month add-on on Relay Cloud |

The clinic owns every account. Relay stores tokens and keys encrypted (AES-256-GCM) and never shows them again.

## 3. Day 0: create and configure the workspace (about 1 hour, with the doctor)

1. **Sign up** at your Relay URL and name the workspace after the clinic.
2. **Settings → General**
   - Type of institution: **Clinic / hospital / diagnostics**. This turns on emergency detection, the no-medical-advice rule, health-data masking, and the patient/doctor features.
   - Emergency number: `108`, or the clinic's emergency line.
   - **Answer mode: Draft** for the first week (see §6).
3. **Settings → Staff & hours**: one row per doctor with specialty, days, hours and average minutes per patient. The queue learns each doctor's real pace after a few visits.
4. **Settings → Prep instructions**: the doctor writes these in their own words, in English and Tamil (fasting for sugar/lipid tests, what to bring for cardiology, vaccination card for children, pre-anaesthetic check-up). Each one is matched by keywords and **approved by the doctor**, and is the only medical-sounding text Relay ever sends without a fresh approval.
5. **Knowledge**: paste the clinic FAQ (timings, fees, doctors' days, insurance/TPA, lab, parking, documents to bring) in English and Tamil, or crawl the clinic website. Use **Ask your AI** to try questions immediately.
6. **Team**: invite the receptionist as *agent* and the doctor as *admin*.

## 4. Day 0–1: bring your own AI key (BYOK)

**Settings → Model & BYOK**

1. Choose a provider: Anthropic (Claude), OpenAI, Google Gemini, Groq, OpenRouter, or a self-hosted OpenAI-compatible server (Ollama/vLLM) for full data residency.
2. Paste the key, choose a fast, inexpensive model, and set a **monthly budget cap in ₹**. When the cap is reached, Relay falls back to the free extractive engine instead of failing.
3. Press **Test connection**.
4. Leave *"Let your AI model help read messy reports"* **off** unless the clinic is comfortable sending report text to that provider. Without it, reports are read by Relay's built-in rules (works well for typed lab reports; scanned photos are flagged for manual entry).

What the model never sees: phone numbers, emails, Aadhaar, PAN, card and UPI numbers, and (in healthcare mode) names of conditions and medicines in the conversation, which are replaced by placeholders before the call and restored after.

Starting without a key is fine: the extractive engine answers verbatim from the FAQ, and the safety rules and visit flows (booking, check-in, waiting time, follow-ups) are rule-based and work identically with or without a model.

## 5. Day 1–3: connect the clinic's WhatsApp number

Meta's business verification can take a few days, so start this first.

1. **Meta Business Manager**: create or verify the clinic's business (business documents and website/phone).
2. **developers.facebook.com → Create app → Business → add the WhatsApp product.**
3. **Add the phone number** and verify it by SMS or voice. If the number is on the WhatsApp app today, back up chats and delete that account first; a number can be on the app or the platform, not both.
4. **Permanent access token**: Business Settings → System users → add a system user with *Full control* of the WhatsApp account → generate a token with `whatsapp_business_messaging` and `whatsapp_business_management`.
5. **In Relay: Settings → Channels → WhatsApp**: paste the **Phone number ID** and the token, then **Save**. Relay shows a **Webhook URL** (`https://<your-relay>/webhooks/whatsapp`) and a **Verify token**.
6. **In Meta: WhatsApp → Configuration → Webhook**: paste both, then subscribe to **messages**.
7. **On the server**, set `WHATSAPP_APP_SECRET` (App settings → Basic → App secret) so Relay rejects forged webhooks.
8. **Create the Utility template** (WhatsApp Manager → Message templates) in **English** and **Tamil**, named `relay_update`:
   `Hello {{1}}, an update from {{2}}:` *(blank line)* `{{3}}` *(blank line)* `Reply here if you have any questions.`
   Relay uses it automatically for reminders, follow-ups and approved results sent more than 24 hours after the patient's last message. Within the 24-hour window it sends plain messages, which are free.
9. **Test from the doctor's own phone**: message the clinic number: "OPD timings?", "appointment venum", "I have reached". The conversation appears in the Inbox within seconds.

Patients who are already on the clinic's list (added at the desk with their phone number) are linked automatically when they message, so "I have reached" checks in their appointment.

## 6. Week 1: let the doctor check every response the AI creates

This is the doctor-in-the-loop rollout. Nothing goes to patients that the clinic has not seen.

| Where | What the doctor/receptionist does |
|---|---|
| **Settings → Answer mode = Draft** | Every AI reply becomes a draft in the Inbox. Staff edit and send, or discard. Edits become knowledge automatically. |
| **Inbox** | See the AI's suggested reply, its sources and confidence before it goes out. |
| **Approvals** | AI findings from reports, and the patient message drafted for them. Edit → Approve and send, or Discard. |
| **Knowledge → Ask your AI** | Type any patient question and see exactly what would be answered, with sources. |
| **Simulations** | Paste 30–50 real questions from the clinic's WhatsApp history, each with the expected answer (`question => expected words`). Aim for a 90%+ pass rate before leaving Draft mode. |
| **Safety drill** | Send emergency and medication questions in Tamil and English ("நெஞ்சு வலி", "can I stop my BP tablet?"). They must always be escalated, never answered. |
| **Analytics** | Resolution rate, handoff reasons, unanswered questions, language mix and CSAT. Add knowledge for the top unanswered questions daily. |

**Week 2:** switch Answer mode to **Auto** for administrative questions. Clinical messages still wait in Approvals; that never changes.

## 7. Calls (telecalling add-on)

1. **Settings → Add-ons → AI telecalling → Start free trial** (cloud), or it is included when self-hosted.
2. **Start with the simulator** (Settings → Channels → Voice → Simulated). Calls appear in **Calls**, and staff press 1/2/3 as the patient to see what happens.
3. **For real calls**, connect **Twilio**: Account SID, Auth token, and a caller ID you are allowed to use. Check Twilio's India number availability and the paperwork it requires; many clinics use a verified caller ID or an Indian number provisioned through a local provider.
   - Reminder calls go out about 26 hours before the appointment: "press 1 to confirm, 2 to change the time" (2 alerts the front desk).
   - Follow-up calls go out a few hours after an unanswered check-in: "1 better, 2 same, 3 worse" (3 alerts the doctor's team immediately).
   - Inbound calls: point the Twilio number's voice webhook to the **inbound URL** shown after saving. The menu reads the caller's next appointment or transfers to the front desk.
4. Indian telecom rules apply: call only the clinic's own patients about their own care (service calls), keep within reasonable hours, and honour opt-outs. Confirm the clinic's obligations with their telephony provider.

## 8. Go-live checklist

- [ ] Paid, always-on hosting; `RELAY_SECRET`, `DATABASE_URL`, `PUBLIC_URL`, `WHATSAPP_APP_SECRET` set; database backups on
- [ ] `PLATFORM_ADMIN_EMAILS` set to your own email only (the `/admin` console is restricted to these accounts)
- [ ] `DEMO_SEED=false` on the clinic's production instance
- [ ] Doctors, hours and prep instructions entered and approved by the doctor
- [ ] FAQ in English and Tamil; simulation pass rate ≥ 90%
- [ ] Safety drill passed (emergency + medication questions escalate)
- [ ] WhatsApp number live, webhook verified, `relay_update` template approved in English and Tamil
- [ ] BYOK key tested with a monthly ₹ cap (or extractive mode chosen deliberately)
- [ ] Consent text reviewed by the clinic (Settings → General), and a notice at reception about WhatsApp updates and, if used, camera check-in
- [ ] Reception QR code printed (`/checkin/<site key>`; the site key is in Settings → Install)
- [ ] Staff trained on Inbox, Approvals, the queue and finishing visits with follow-up days
- [ ] One week in Draft mode, reviewed with the doctor, before Auto mode

## 9. Rollout timeline

| Week | Focus | Success measure |
|---|---|---|
| 0 | Workspace, doctors, prep instructions, FAQ, BYOK; start Meta verification | Simulation pass rate ≥ 90% |
| 1 | WhatsApp live in **Draft** mode; staff approve everything | < 10% of drafts need edits by Friday |
| 2 | **Auto** for admin questions; bookings, check-in and waiting time live | 60%+ of chats resolved by AI; no-shows tracked |
| 3 | Report uploads, findings and approvals in daily use; follow-ups on | Doctor reviews findings daily; zero unapproved clinical messages |
| 4 | Reminder calls (simulated → Twilio) for patients who don't read WhatsApp | No-show rate down vs week 2 |

## 10. Data protection notes (DPDP Act)

- Health information is sensitive. Relay masks it before model calls, keeps an audit trail of every approval, consent, finding and message, and supports export/erase per patient (Settings → Privacy).
- Choose a model provider and region the clinic is comfortable with; self-hosting with a local model keeps everything on the clinic's own servers.
- Camera check-in is opt-in per patient, runs on-premises, and deletes templates after the visit day (`apps/edge-checkin`).
- Relay is a front-desk and coordination tool. It does not diagnose or advise; clinical decisions stay with the doctor. Have the clinic's own advisor review the consent text and data-processing terms before go-live.
