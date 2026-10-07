# Product Hunt launch kit

> Product Hunt is a launch and listing platform, not a host. The app runs at your production URL. The PH listing links to it and to the GitHub repo. The **maker** submits the listing from their own Product Hunt account at <https://www.producthunt.com/posts/new>.

## ⚠️ Decide the name first

"Relay" is crowded on Product Hunt. Several products already use it, including **Relay.app** (workflow automation, Launch of the Day/Week in Oct 2023 and Jun 2024), an AI work assistant, an Android UI handoff tool and a Claude Code plugin. A unique name will rank, be searchable and be trademarkable.

Some options that fit the "next billion" story (check the domain, PH, GitHub and the trademark registry before choosing):

| Name | Meaning |
|---|---|
| **Uttar** | "answer" in Hindi and Kannada (ಉತ್ತರ / उत्तर) |
| **Jawab** | "reply" in Hindi/Urdu |
| **Sahay** | "help" in Hindi |
| **Bolo Support** | "speak" in Hindi |

Renaming is a find-and-replace on "Relay" in `apps/web`, the widget footer text, the README and this file.

---

## Listing copy

**Name:** Relay *(or the new name)*

**Tagline (58/60 chars):**
> Open-source AI support agent for WhatsApp, in any language

Alternates: "Open-source Fin alternative for WhatsApp-first businesses" (57) · "AI support that speaks Hindi, Kannada & Tamil. Open source." (59)

**Description (≤ 260 chars):**
> Relay answers customer questions on WhatsApp and web chat in Hindi, Kannada, Tamil and English, cites your help docs, looks up orders, and hands off to your team when unsure. Open source, BYOK, self-hostable, and about 16× cheaper than Fin per resolution.

**Topics:** Customer Support · Artificial Intelligence · Open Source · Developer Tools

**Links:**
- Website: `https://<your-domain>` (live demo at `/demo`)
- GitHub: `https://github.com/<you>/relay`

**Pricing:** Free (open source) · Freemium cloud: ₹0 / ₹999 / ₹3,999 per month

**Launch offer:** 3 months of Starter free for Product Hunt users. Create a Razorpay offer/coupon and mention it in the first comment.

---

## Maker's first comment

> Hi Product Hunt 👋
>
> I built Relay because **AI support is priced for Silicon Valley, but most of the world's customer support happens on WhatsApp, in Hindi, Kannada or Tamil, for businesses that count every rupee.**
>
> Fin is great, but at $0.99 per resolution with a 50-resolution monthly minimum plus seats, it's out of reach for 90% of the D2C brands, clinics and coaching institutes I know in India.
>
> **What Relay does:**
> 🗣️ Answers in the customer's language, from your help docs, with citations
> 💬 Works on WhatsApp and a one-line web widget
> 👥 Multiplayer inbox: AI drafts, a human approves in one tap, and every edit teaches the AI
> ⚡ Looks up orders through your API; refunds and cancellations need a human to verify
> 🩹 "Self-healing" integrations: when your order API changes shape, Relay proposes the fix
> 🧪 Simulations: test 50 questions and see a pass rate before going live
> 🔐 Customer PII is redacted before any LLM sees it (built for India's DPDP Act)
>
> **Why open source + BYOK:** bring your own Claude, OpenAI or Gemini key, run open-weight models on Ollama, or run with *no LLM at all* (the extractive mode answers verbatim from your docs, free). Self-host with one `docker compose up`.
>
> **Try it:** the demo store at `<your-domain>/demo` answers in English, हिंदी and ಕನ್ನಡ. Ask it "Where is my order KC-1042?"
>
> 🎁 PH offer: 3 months of Starter free.
>
> I'd love your feedback, especially if you run support for an Indian business. What would make you switch?

---

## Gallery (1270×760 PNG, 3–5 images)

Captured from the running product into `launch/gallery/`. To regenerate, see "Capturing the gallery" below.

1. `1-demo-widget.png`: the demo store with the widget answering in Hindi and Kannada, with citations.
2. `2-inbox.png`: the multiplayer inbox with an AI draft awaiting approval and a sensitive-action verification card.
3. `3-simulation.png`: simulation results with the pass rate.
4. `4-analytics.png`: resolution rate, CSAT, cost per resolution, and "vs Fin pricing".
5. `5-landing.png`: the hero and the price comparison.

Thumbnail: `apps/web/public/icon-512.png` (240×240 minimum; animated GIF optional).

## Video script (60–90 s)

| Time | Shot | Voice-over |
|---|---|---|
| 0–8s | Landing hero | "AI support is priced for Silicon Valley. Most support happens on WhatsApp, in Hindi, Kannada, Tamil." |
| 8–25s | Demo store, type in Hindi, then Kannada | "Relay answers in your customer's language, straight from your help docs, with sources." |
| 25–38s | "Where is my order KC-1042?" → order status | "It calls your order API." |
| 38–52s | "Cancel my order" → inbox → Approve & run | "Refunds and cancellations wait for a human. One tap to verify." |
| 52–65s | Low-confidence draft → edit → send → ask again → AI answers | "When it's unsure, it asks your team, and learns from every edit." |
| 65–80s | Simulations pass rate → Analytics vs Fin | "Test before you go live. Roughly 16× cheaper than Fin, or free if you self-host." |
| 80–90s | Terminal: `docker compose up` + GitHub | "Open source. Bring your own model. Link below." |

Record with OBS (open source) at 1920×1080 and upload to YouTube or Loom.

---

## Launch-day checklist

- [ ] **Name decided** and domain bought (`.com`/`.in`, about ₹800–1,200/yr)
- [ ] Production deployed on the custom domain with HTTPS, `RELAY_SECRET` set, `DEMO_PASSWORD` changed
- [ ] Demo workspace re-seeded and `/demo` smoke-tested in English, Hindi and Kannada
- [ ] Platform model configured (`LLM_PROVIDER` + key, or keep extractive), with a **budget cap** on the demo workspace (Settings → Model)
- [ ] Rate limits verified (widget: 20 msgs/min per visitor, 40 per IP, 600 per workspace)
- [ ] GitHub repo public: README, LICENSE, demo GIF, topics (`customer-support`, `whatsapp`, `ai-agent`, `open-source`, `india`)
- [ ] Razorpay in live mode (KYC done), plans created, webhook pointed at `/webhooks/razorpay`, PH coupon created
- [ ] Status page (e.g. open-source Uptime Kuma, or UptimeRobot) monitoring `/healthz`
- [ ] Gallery images + video uploaded to the draft listing; first comment ready
- [ ] Schedule for **12:01 AM PT (12:31 PM IST), Tuesday–Thursday**
- [ ] Tell early supporters the launch is live. **Don't ask for upvotes**: Product Hunt forbids it and penalizes vote-asking. Ask for feedback instead.
- [ ] Reply to every comment within the hour, all day
- [ ] Post on X/LinkedIn, Indian founder communities, r/selfhosted and Hacker News ("Show HN") the same week

## Capturing the gallery

With the server running (`pnpm start`):

```bash
node launch/capture.mjs            # writes launch/gallery/*.png (uses Edge/Chrome via puppeteer-core)
```
