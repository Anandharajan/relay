# Security policy

Relay handles customer conversations and API keys, so we take security reports seriously.

## Reporting a vulnerability

**Please don't open a public issue.** Use GitHub's private reporting: **Security → Report a vulnerability** on this repository.

Include steps to reproduce, the affected version or commit, and the impact. We aim to acknowledge reports within 72 hours and to ship a fix for confirmed high-severity issues within 14 days, crediting you in the release notes unless you prefer otherwise.

## Supported versions

Only the latest release receives security fixes.

## Scope highlights

These matter most to us: tenant isolation (cross-`org_id` access), widget token or origin bypass, PII reaching an LLM unredacted, BYOK key disclosure, SSRF via the crawler or Actions, and webhook signature bypass (Razorpay, WhatsApp).
