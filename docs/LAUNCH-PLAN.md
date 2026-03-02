# SessionForge Launch Plan

> Status: ON HOLD — pending QA completion
> Return to this doc when QA passes and you're ready to launch.

---

## Pre-Launch Gate

- [ ] sessionforge.dev QA complete and passing
- [ ] Stripe switched to live mode (see steps below)
- [ ] sessionforge.dev health check: `curl -s https://sessionforge.dev/api/health`

---

## Platform Setup (do day-of)

- [ ] Create SessionForge LinkedIn company page
- [ ] Create @SessionForge on X/Twitter (fallback: @SessionForgeDev)
- [ ] Upload logo, bio, website link to both accounts
- [ ] Create Product Hunt draft listing (content below), schedule 12:01am PT launch day
- [ ] Verify HN account karma is sufficient for Show HN

---

## Stripe Live Mode Switch

1. Go to https://dashboard.stripe.com → switch to live mode
2. Get live keys: `pk_live_...` and `sk_live_...`
3. Update Cloud Run:

```bash
gcloud run services update sessionforge \
  --region us-central1 \
  --project sessionforge-487719 \
  --update-env-vars "STRIPE_SECRET_KEY=sk_live_...,NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_..."
```

4. Register live webhook at https://sessionforge.dev/api/webhooks/stripe
   - Events: checkout.session.completed, invoice.paid, invoice.payment_failed, customer.subscription.updated, customer.subscription.deleted
5. Add webhook secret:

```bash
gcloud run services update sessionforge \
  --region us-central1 \
  --project sessionforge-487719 \
  --update-env-vars "STRIPE_WEBHOOK_SECRET=whsec_live_..."
```

---

## Launch Day Sequence

| Time (ET) | Action                                           |
| --------- | ------------------------------------------------ |
| 12:01am   | Product Hunt listing goes live                   |
| 9:00am    | Show HN posted                                   |
| 9:30am    | SessionForge LinkedIn + X brand posts            |
| 10:00am   | Perry personal LinkedIn post (see content below) |
| 10:00am   | Reddit r/ClaudeAI + r/SideProject posts          |
| 12:00pm   | Respond to all PH comments                       |
| All day   | Respond to LinkedIn comments + DMs               |

---

## All Content — Ready to Paste

### Product Hunt Listing

**Name:** SessionForge

**Tagline:**

```
Manage your Claude Code sessions from anywhere
```

**Description:**

```
I kept losing track of which Claude Code sessions were running on which machines.

SessionForge fixes that.

A lightweight Go agent runs on each of your machines. A web dashboard shows you everything in real time — which sessions are active, on which machine, for how long. You can start, stop, and get alerts from anywhere, including your phone.

Free tier for solo developers. Team plans for engineering orgs that need org-wide visibility and management.

The agent is open source (MIT licensed). The platform is free to start — no credit card required.
```

**Maker First Comment** (post immediately at launch):

```
Hey Product Hunt 👋

I'm Perry. I built SessionForge because I was running Claude Code across 3 machines and had zero visibility into what was happening where. A session would spin up, run for hours, and I'd have no idea until I physically checked the machine.

The Go agent installs in about 30 seconds. The dashboard works on mobile. You can kill a runaway session from your phone while you're away from your desk.

The agent is MIT licensed and open source. The platform is genuinely free to start — no credit card, no trial expiry.

Would love to hear from anyone else juggling multiple AI coding environments. What does your current setup look like?
```

---

### Show HN

**Title:**

```
Show HN: SessionForge – manage your Claude Code sessions from anywhere
```

**Body:**

```
I built this because I kept losing track of which Claude Code sessions were running on which machines. A session would spin up, run for hours, and I'd only find out when I checked manually.

SessionForge is a remote AI session manager. A lightweight Go agent (open source, MIT) runs on each machine. A web dashboard lets you monitor, start, stop, and get alerts from anywhere — including mobile.

Free to start, no credit card. Team plans for engineering orgs.

https://sessionforge.dev

Happy to answer questions about the architecture — the agent uses a polling model over HTTPS so it works without any port forwarding or firewall changes.
```

---

### SessionForge LinkedIn Company Page — Launch Post

_(Schedule 9:30am ET)_

```
SessionForge is live.

If you're running Claude Code sessions across multiple machines, you know the problem — no visibility into what's running where, on which machine, for how long.

SessionForge gives you a real-time dashboard for all of it. Monitor, start, stop, get alerts. From your browser or your phone.

Free to start, open source agent.

https://sessionforge.dev
```

---

### @SessionForge X/Twitter — Launch Tweet

_(Schedule 9:30am ET)_

```
SessionForge is live.

Real-time dashboard for all your Claude Code sessions across every machine.

Monitor, start, stop, get alerts — from anywhere. Free to start.

https://sessionforge.dev
```

---

### Perry Personal LinkedIn — sessionforge.dev

_(PENDING — to be written when ready)_

---

### Reddit — r/ClaudeAI

_(Post 10:00am ET)_

**Title:**

```
Built a tool to manage Claude Code sessions across multiple machines — SessionForge
```

**Body:**

```
I kept losing track of which Claude Code sessions were running on which of my machines. A session would spin up and run for hours without me knowing.

So I built SessionForge — a lightweight Go agent runs on each machine, and a web dashboard shows you everything in real time. You can monitor, start, stop, and get alerts from anywhere including your phone.

The agent is MIT licensed and open source. The platform is free to start.

https://sessionforge.dev

Would love feedback from anyone else running Claude Code across multiple machines — what's your current setup?
```

---

### Reddit — r/SideProject

_(Post 10:00am ET)_

**Title:**

```
I built SessionForge — remote AI session management for developers
```

**Body:**

```
Side project I've been building: SessionForge.

Problem it solves: I run Claude Code across 3 machines and had zero visibility into what was running where. A session would spin up, consume resources, and I'd have no idea.

What I built: A lightweight Go agent that runs on each machine + a web dashboard that shows all your sessions in real time. Monitor, start, stop, get alerts from anywhere — mobile included.

Stack: Go agent (open source, MIT), Next.js dashboard, deployed on GCP Cloud Run.

Free to start, no credit card.

https://sessionforge.dev

Happy to answer questions about the build — it was an interesting problem, especially getting the agent to work reliably without requiring port forwarding.
```

---

## 30-Day Goals

- 500 signups
- 15 paid conversions

## Post-Launch Tracking

- Product Hunt upvotes + rank
- Signups (check DB / admin dashboard)
- Show HN points + comments
- Stripe live subscriptions
