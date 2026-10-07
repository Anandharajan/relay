import { config } from './config.ts';
import { ctx } from './ctx.ts';
import { hashPassword, uuid } from './lib/crypto.ts';
import { ingestSource } from './jobs/ingest.ts';
import { createOrg, getOrg } from './services/orgs.ts';
import { addMessage, createConversation, resolve, runAi, setStatus } from './services/conversations.ts';

export const DEMO_ORG_NAME = 'Kaapi & Co.';

const faqEnglish = `# Kaapi & Co. Help Center

## Shipping & delivery
Q: How long does delivery take?
A: Orders ship within 24 hours from our Bengaluru roastery. Delivery takes 2-3 business days in metro cities and 4-6 business days elsewhere in India.

Q: Do you offer free shipping?
A: Yes, shipping is free on orders above ₹599. Below that, a flat ₹49 shipping fee applies.

Q: Do you ship internationally?
A: Not yet. We currently deliver only within India, to over 19,000 pin codes.

Q: How can I track my order?
A: You get a tracking link on WhatsApp and email as soon as your order ships. You can also ask me with your order ID (for example KC-1042).

## Returns & refunds
Q: What is your return policy?
A: Unopened coffee can be returned within 7 days of delivery. Opened packs can't be returned for hygiene reasons, but if your coffee arrived damaged or stale we replace it free of cost.

Q: How long do refunds take?
A: Refunds are processed within 24 hours of approval and reach your UPI or card account in 5-7 business days.

## Products & brewing
Q: Which grind should I choose?
A: Choose fine grind for espresso and South Indian filter coffee (decoction), medium for pour-over and AeroPress, and coarse for French press and cold brew.

Q: Is your coffee fresh?
A: Every batch is roasted to order and shipped within 48 hours of roasting. The roast date is printed on every pack.

Q: Do you sell chicory blends?
A: Yes. Our Filter Coffee Kit uses an 80:20 coffee-chicory blend, the classic Kumbakonam style. All our other coffees are 100% arabica or robusta with no chicory.

Q: How should I store coffee?
A: Keep the pack sealed with its one-way valve, away from sunlight and moisture. Don't refrigerate it. Coffee tastes best within 4 weeks of the roast date.

## Payments
Q: Which payment methods do you accept?
A: UPI (GPay, PhonePe, Paytm), all major credit and debit cards, net banking, and Cash on Delivery for orders up to ₹2,000.

Q: Is Cash on Delivery available?
A: Yes, COD is available for orders up to ₹2,000 with a ₹30 handling fee.

## Subscriptions
Q: How does the coffee subscription work?
A: Pick a coffee and a frequency (every 2, 4 or 6 weeks). You get 10% off every delivery and can pause, skip or cancel anytime from your account page.

## Wholesale
Q: Do you supply cafes and offices?
A: Yes, we offer wholesale pricing for cafes, restaurants and offices starting at 5 kg per month, with GST invoices. A teammate will share a quote.
`;

const faqHindi = `# सहायता केंद्र (हिंदी)

प्रश्न: डिलीवरी में कितने दिन लगते हैं?
उत्तर: ऑर्डर 24 घंटे के अंदर हमारी बेंगलुरु रोस्टरी से भेजे जाते हैं। मेट्रो शहरों में डिलीवरी 2-3 कार्यदिवस और बाकी भारत में 4-6 कार्यदिवस में होती है।

प्रश्न: क्या फ्री शिपिंग मिलती है?
उत्तर: हाँ, ₹599 से ऊपर के ऑर्डर पर शिपिंग मुफ्त है। उससे कम पर ₹49 शिपिंग शुल्क लगता है।

प्रश्न: रिफंड में कितना समय लगता है?
उत्तर: मंज़ूरी के 24 घंटे के अंदर रिफंड प्रोसेस होता है और 5-7 कार्यदिवस में आपके UPI या कार्ड खाते में पहुँच जाता है।

प्रश्न: क्या कैश ऑन डिलीवरी उपलब्ध है?
उत्तर: हाँ, ₹2,000 तक के ऑर्डर पर कैश ऑन डिलीवरी (COD) उपलब्ध है, ₹30 हैंडलिंग शुल्क के साथ।

प्रश्न: रिटर्न पॉलिसी क्या है?
उत्तर: बिना खुली कॉफ़ी डिलीवरी के 7 दिनों के अंदर लौटाई जा सकती है। अगर कॉफ़ी खराब या बासी पहुँचे, तो हम उसे मुफ्त में बदल देंगे।
`;

const faqKannada = `# ಸಹಾಯ ಕೇಂದ್ರ (ಕನ್ನಡ)

ಪ್ರಶ್ನೆ: ಡೆಲಿವರಿಗೆ ಎಷ್ಟು ದಿನ ಬೇಕು?
ಉತ್ತರ: ಆರ್ಡರ್‌ಗಳನ್ನು 24 ಗಂಟೆಗಳಲ್ಲಿ ನಮ್ಮ ಬೆಂಗಳೂರು ರೋಸ್ಟರಿಯಿಂದ ಕಳುಹಿಸಲಾಗುತ್ತದೆ. ಮೆಟ್ರೋ ನಗರಗಳಿಗೆ 2-3 ಕೆಲಸದ ದಿನಗಳು, ಇತರೆಡೆ 4-6 ಕೆಲಸದ ದಿನಗಳು ಬೇಕು.

ಪ್ರಶ್ನೆ: ಉಚಿತ ಶಿಪ್ಪಿಂಗ್ ಇದೆಯೇ?
ಉತ್ತರ: ಹೌದು, ₹599 ಕ್ಕಿಂತ ಹೆಚ್ಚಿನ ಆರ್ಡರ್‌ಗಳಿಗೆ ಶಿಪ್ಪಿಂಗ್ ಉಚಿತ. ಅದಕ್ಕಿಂತ ಕಡಿಮೆ ಇದ್ದರೆ ₹49 ಶುಲ್ಕ ಅನ್ವಯಿಸುತ್ತದೆ.

ಪ್ರಶ್ನೆ: ರೀಫಂಡ್‌ಗೆ ಎಷ್ಟು ಸಮಯ ಬೇಕು?
ಉತ್ತರ: ಅನುಮೋದನೆಯ 24 ಗಂಟೆಗಳಲ್ಲಿ ರೀಫಂಡ್ ಪ್ರಕ್ರಿಯೆಗೊಳ್ಳುತ್ತದೆ ಮತ್ತು 5-7 ಕೆಲಸದ ದಿನಗಳಲ್ಲಿ ನಿಮ್ಮ UPI ಅಥವಾ ಕಾರ್ಡ್ ಖಾತೆಗೆ ತಲುಪುತ್ತದೆ.

ಪ್ರಶ್ನೆ: ಕ್ಯಾಶ್ ಆನ್ ಡೆಲಿವರಿ ಲಭ್ಯವಿದೆಯೇ?
ಉತ್ತರ: ಹೌದು, ₹2,000 ವರೆಗಿನ ಆರ್ಡರ್‌ಗಳಿಗೆ ಕ್ಯಾಶ್ ಆನ್ ಡೆಲಿವರಿ (COD) ಲಭ್ಯವಿದೆ, ₹30 ನಿರ್ವಹಣಾ ಶುಲ್ಕದೊಂದಿಗೆ.
`;

const sampleChats: { q: string; outcome: 'resolved' | 'open' | 'idle'; daysAgo: number; name?: string }[] = [
  { q: 'How long does delivery take to Pune?', outcome: 'resolved', daysAgo: 12, name: 'Ananya' },
  { q: 'Do you have cash on delivery?', outcome: 'resolved', daysAgo: 11 },
  { q: 'डिलीवरी में कितने दिन लगते हैं?', outcome: 'resolved', daysAgo: 10, name: 'Rohit' },
  { q: 'Which grind should I buy for a french press?', outcome: 'resolved', daysAgo: 9 },
  { q: 'ಉಚಿತ ಶಿಪ್ಪಿಂಗ್ ಇದೆಯೇ?', outcome: 'resolved', daysAgo: 8, name: 'Kavya' },
  { q: 'where is my order KC-1042', outcome: 'resolved', daysAgo: 7 },
  { q: 'Is the coffee fresh? When is it roasted?', outcome: 'resolved', daysAgo: 6 },
  { q: 'रिफंड में कितना समय लगता है?', outcome: 'resolved', daysAgo: 5 },
  { q: 'How does the subscription work?', outcome: 'resolved', daysAgo: 4, name: 'Meera' },
  { q: 'ಡೆಲಿವರಿಗೆ ಎಷ್ಟು ದಿನ ಬೇಕು?', outcome: 'resolved', daysAgo: 3 },
  { q: 'Can I get a custom GST invoice with my company name for last month\'s order?', outcome: 'open', daysAgo: 1, name: 'Vikram (Brew Lab Cafe)' },
  { q: 'Can I pay with UPI?', outcome: 'idle', daysAgo: 0 },
];

export async function seedDemo(): Promise<void> {
  if (!config.demo.seed) return;
  const existing = await ctx.db.one<{ id: string }>('select id from users where email = $1', [config.demo.email]);
  if (existing) return;
  console.log('[seed] creating demo workspace…');

  const userId = uuid();
  await ctx.db.query('insert into users (id, email, name, password_hash) values ($1, $2, $3, $4)', [userId, config.demo.email, 'Demo Owner', await hashPassword(config.demo.password)]);
  const org = await createOrg(DEMO_ORG_NAME, userId, {
    botName: 'Kaapi Assistant',
    brandColor: '#8b4513',
    greeting: 'Namaste! ☕ Ask me about orders, delivery or brewing — in English, हिंदी or ಕನ್ನಡ.',
    confidenceThreshold: 0.45,
  });

  for (const [title, content] of [['Help Center (English)', faqEnglish], ['सहायता केंद्र (हिंदी)', faqHindi], ['ಸಹಾಯ ಕೇಂದ್ರ (ಕನ್ನಡ)', faqKannada]] as const) {
    const id = uuid();
    await ctx.db.query(`insert into knowledge_sources (id, org_id, type, title, content) values ($1, $2, 'faq', $3, $4)`, [id, org.id, title, content]);
    await ingestSource({ sourceId: id });
  }

  const storeApi = `${config.publicUrl}/demo-api`;
  await ctx.db.query(
    `insert into actions (id, org_id, name, description, keywords, method, url, params, response_template, sensitive) values
     ($1, $2, 'Order status', 'Look up the status, courier and delivery date of an order by its order ID.', $3::jsonb, 'GET', $4, $5::jsonb, $6, false),
     ($7, $2, 'Cancel order', 'Cancel an order and start a refund. Requires human verification.', $8::jsonb, 'POST', $9, $5::jsonb, $10, true)`,
    [
      uuid(), org.id,
      ['order', 'track', 'tracking', 'where is my', 'status', 'ऑर्डर', 'ಆರ್ಡರ್'],
      `${storeApi}/orders/{order_id}`,
      [{ name: 'order_id', description: 'order ID (like KC-1042)', required: true, pattern: '(KC-?\\d{3,6})' }],
      'Order {{id}} ({{item}}) is {{status}}. Courier: {{courier}}. Expected delivery: {{eta}}.',
      uuid(),
      ['cancel order', 'cancel my order', 'cancel', 'रद्द', 'ರದ್ದು'],
      `${storeApi}/orders/{order_id}/cancel`,
      'Order {{id}} has been cancelled. A refund of ₹{{refund.amount_inr}} will reach your {{refund.method}} in about {{refund.eta_days}} days.',
    ],
  );

  // Sample traffic so the inbox and analytics aren't empty on first login.
  const demo = (await getOrg(org.id))!;
  for (const chat of sampleChats) {
    const conv = await createConversation(demo, `v_demo_${uuid().slice(0, 8)}`, 'web', { name: chat.name });
    await addMessage(conv, 'customer', chat.q);
    const out = await runAi(demo, conv, chat.q);
    if (chat.outcome === 'resolved' && out.kind !== 'handoff') await resolve(conv, 'ai', chat.daysAgo % 3 === 0 ? 4 : 5);
    if (chat.outcome === 'open' && out.kind !== 'handoff') await setStatus(conv, 'escalated');
    const shift = `${chat.daysAgo} days`;
    await ctx.db.query(
      `update conversations set created_at = created_at - $2::interval, last_message_at = last_message_at - $2::interval, resolved_at = resolved_at - $2::interval where id = $1`,
      [conv.id, shift],
    );
    await ctx.db.query(`update messages set created_at = created_at - $2::interval where conversation_id = $1`, [conv.id, shift]);
  }
  console.log(`[seed] demo workspace ready → sign in as ${config.demo.email} (password from DEMO_PASSWORD, see .env.example)`);
}

export async function demoSiteKey(): Promise<string | null> {
  const row = await ctx.db.one<{ site_key: string }>('select site_key from orgs where name = $1 order by created_at limit 1', [DEMO_ORG_NAME]);
  return row?.site_key ?? null;
}
