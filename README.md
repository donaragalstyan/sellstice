# Sellstice

An AI-powered resale coach: turn a financial goal ("make $1,000 in 4 months")
into an actionable plan for what to sell, when to list it, how to price it,
and what to do next.

This repo is in **Phase 0** of the implementation plan: project scaffolding
and authentication only. Goals, inventory, listings, and AI features land in
later phases.

## Stack

Next.js (App Router, TypeScript) · Prisma · PostgreSQL · Auth.js (Credentials
provider, JWT sessions) · Tailwind CSS

## Local setup

1. Copy `.env.example` to `.env` and fill in `AUTH_SECRET` (generate one with
   `npx auth secret`). The default `DATABASE_URL` matches the Docker Compose
   service below — leave it as-is unless you're pointing at a different DB.
2. Start Postgres:
   ```bash
   docker compose up -d
   ```
3. Install dependencies and apply migrations:
   ```bash
   npm install
   npx prisma migrate dev
   ```
4. Run the dev server:
   ```bash
   npm run dev
   ```
5. Visit http://localhost:3000, sign up, and you'll land on `/dashboard`.

## What's here

- Email/password signup and login (Auth.js Credentials provider, bcrypt
  hashing, JWT sessions — no OAuth app registration needed yet).
- `/dashboard` is protected by `src/proxy.ts` (Next.js's middleware
  convention), which redirects unauthenticated requests to `/login` with a
  `callbackUrl`.
- `User` is currently the only Prisma model. Goal, Item, Listing, and the
  rest of the schema are introduced in later phases as their features are
  built.

## Notes for later phases

- Auth config is split into `src/lib/auth.config.ts` (edge-safe, used by
  `proxy.ts`) and `src/lib/auth.ts` (full config with the Credentials
  provider, used by server routes/actions) — the Credentials provider pulls
  in Prisma/bcrypt, which can't run in the Edge runtime middleware uses.
- Prisma 7 requires an explicit driver adapter; `src/lib/prisma.ts` wires up
  `@prisma/adapter-pg`.
