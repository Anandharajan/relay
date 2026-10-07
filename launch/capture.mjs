// Capture Product Hunt gallery images (1270×760) from a running Relay server.
// Usage: node launch/capture.mjs [baseUrl]   (default http://localhost:8787)
// Uses an installed Edge/Chrome through puppeteer-core; set BROWSER_PATH to override.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const base = (process.argv[2] ?? 'http://localhost:8787').replace(/\/$/, '');
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'gallery');
mkdirSync(out, { recursive: true });

function envValue(key, fallback) {
  try {
    const line = readFileSync(join(here, '..', '.env'), 'utf8').split('\n').find((l) => l.startsWith(`${key}=`));
    if (line && line.split('=')[1].trim()) return line.split('=').slice(1).join('=').trim();
  } catch {}
  return process.env[key] || fallback;
}
const demoEmail = envValue('DEMO_EMAIL', 'demo@relay.local');
const demoPassword = envValue('DEMO_PASSWORD', 'relay-demo-1234');

const candidates = [
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) throw new Error('No Chrome/Edge found. Set BROWSER_PATH.');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (r) => r.json();

async function widgetVisitor(siteKey) {
  const s = await fetch(`${base}/widget/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ siteKey }) }).then(json);
  const H = { 'content-type': 'application/json', authorization: `Bearer ${s.token}` };
  let conversationId = null;
  return {
    async say(content, name) {
      const r = await fetch(`${base}/widget/messages`, { method: 'POST', headers: H, body: JSON.stringify({ content, conversationId, name }) }).then(json);
      conversationId = r.conversationId;
      await sleep(600);
      return conversationId;
    },
  };
}

const browser = await puppeteer.launch({ executablePath, headless: true, defaultViewport: { width: 1270, height: 760, deviceScaleFactor: 1 } });
try {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  const { demoSiteKey } = await fetch(`${base}/api/public/config`).then(json);
  if (!demoSiteKey) throw new Error('Demo workspace not seeded (DEMO_SEED=true)');

  // 1. Demo store with the widget answering in Hindi and Kannada.
  await page.goto(`${base}/demo`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.getElementById('relay-widget')?.shadowRoot?.querySelector('.panel.open'));
  for (const q of ['डिलीवरी में कितने दिन लगते हैं?', 'ಉಚಿತ ಶಿಪ್ಪಿಂಗ್ ಇದೆಯೇ?']) {
    await page.evaluate((text) => {
      const root = document.getElementById('relay-widget').shadowRoot;
      root.querySelector('textarea').value = text;
      root.querySelector('form').requestSubmit();
    }, q);
    await sleep(1800);
  }
  await page.screenshot({ path: join(out, '1-demo-widget.png') });
  console.log('✓ 1-demo-widget.png');

  // Seed a realistic escalation: a sensitive cancellation + an @AI draft.
  const priya = await widgetVisitor(demoSiteKey);
  await priya.say('Hi! I ordered twice by mistake 😅', 'Priya Sharma');
  const convId = await priya.say('Please cancel my order KC-4242, I only need one Filter Coffee Kit');
  // While escalated, the AI stays quiet; the team asks @AI for a draft on her follow-up.
  await priya.say('And how long will the refund take to reach my UPI?');

  // Sign in as the demo owner.
  await page.goto(`${base}/login`, { waitUntil: 'networkidle2' });
  await page.evaluate(async (email, password) => {
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-csrf': '1' }, body: JSON.stringify({ email, password }) });
    if (!r.ok) throw new Error('login failed');
  }, demoEmail, demoPassword);
  await page.evaluate(async (id) => {
    await fetch(`/api/inbox/conversations/${id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-relay-csrf': '1' },
      body: JSON.stringify({ content: '@AI draft the refund timeline for her', note: true }),
    });
  }, convId);

  // 2. Multiplayer inbox.
  await page.goto(`${base}/app/inbox/${convId}`, { waitUntil: 'networkidle2' });
  await sleep(1200);
  await page.screenshot({ path: join(out, '2-inbox.png') });
  console.log('✓ 2-inbox.png');

  // 3. Simulation.
  const simId = await page.evaluate(async () => {
    const questions = [
      'How long does delivery take? => 2-3',
      'Do you ship internationally? => india',
      'Which grind for French press? => coarse',
      'Is cash on delivery available? => 2,000',
      'क्या फ्री शिपिंग मिलती है? => 599',
      'ರೀಫಂಡ್‌ಗೆ ಎಷ್ಟು ಸಮಯ ಬೇಕು? => 5-7',
      'How should I store coffee? => sunlight',
      'Do you sell chicory blends? => 80:20',
      'Do you supply cafes? => wholesale',
      'Can I pause my subscription? => pause',
      'Do you sell matcha?',
    ].join('\n');
    const r = await fetch('/api/simulations', { method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-csrf': '1' }, body: JSON.stringify({ name: 'Pre-launch check', questions }) });
    return (await r.json()).id;
  });
  await sleep(2500);
  await page.goto(`${base}/app/simulations/${simId}`, { waitUntil: 'networkidle2' });
  await sleep(800);
  await page.screenshot({ path: join(out, '3-simulation.png') });
  console.log('✓ 3-simulation.png');

  // 4. Analytics.
  await page.goto(`${base}/app/analytics`, { waitUntil: 'networkidle2' });
  await sleep(800);
  await page.screenshot({ path: join(out, '4-analytics.png') });
  console.log('✓ 4-analytics.png');

  // 5. Landing page.
  await page.goto(`${base}/`, { waitUntil: 'networkidle2' });
  await sleep(500);
  await page.screenshot({ path: join(out, '5-landing.png') });
  console.log('✓ 5-landing.png');
} finally {
  await browser.close();
}
console.log(`Gallery written to ${out}`);
