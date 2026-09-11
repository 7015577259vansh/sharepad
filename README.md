# SharePad

A lightweight, no-login note and photo sharing app.

**Live demo:** [sharepad-ten.vercel.app](https://sharepad-ten.vercel.app)

## Overview

SharePad lets anyone create a shared page by simply choosing a code — no sign-up, no account, no friction. Whoever knows the code can view and edit the same page from any device. It's built for quick, throwaway sharing: pasting notes, dropping a few photos, and sending the link to someone else.

The core idea was to solve a common friction point with tools like Google Docs (mandatory login) by keeping everything anonymous and code-based, while still supporting image uploads.

## Features

- **No login required** — access any page instantly with a shared code
- **Live autosave** — text saves automatically as you type
- **Photo uploads** — up to 12 images per page, client-side resized and compressed before upload to keep storage efficient
- **Full-size photo preview** — click any thumbnail to view it in a lightbox
- **Secure random codes** — a built-in generator creates long, non-guessable codes, since short/common codes are trivial to brute-force
- **Realtime persistence** — backed by a real Postgres database (Supabase), not local/browser storage, so pages persist across devices and sessions

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite |
| Backend / Database | Supabase (Postgres + Row Level Security) |
| Hosting | Vercel |
| Image handling | Client-side canvas resizing before upload |

## Architecture notes

- All data is stored in a single `pages` table (`code`, `text`, `photos`, `updated_at`) in Supabase
- Row Level Security (RLS) policies control read/write access at the database level
- Images are resized and compressed in-browser (max 1000px, JPEG ~70% quality) before being base64-encoded and stored, keeping payloads small without needing separate file storage infrastructure
- The app is a fully static single-page app — no custom backend server required

## Setup and local development

### 1. Create a Supabase project

1. Sign up at [supabase.com](https://supabase.com) and create a new project
2. In the SQL Editor, run the contents of `supabase_setup.sql` to create the `pages` table and its policies
3. From **Project Settings > API**, copy your Project URL and anon/publishable key
4. From **Integrations > Data API > Settings**, make sure the `pages` table is toggled on under "Exposed tables"

### 2. Local development

```bash
git clone <this-repo-url>
cd sharepad
npm install
cp .env.example .env   # then fill in your Supabase URL and key
npm run dev
```

### 3. Deploy

The project is set up to deploy on [Vercel](https://vercel.com) with zero configuration:

1. Import the GitHub repo into a new Vercel project (Vite is auto-detected)
2. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables
3. Deploy — any future push to `main` triggers an automatic redeploy

## Security considerations

- Pages are protected only by the obscurity of their code — the built-in random code generator is the recommended way to create pages, since short/predictable codes can be discovered
- Row Level Security policies currently allow open read/write access, matching the "no login" design goal
- Planned improvements: optional PIN/password protection per page, automatic expiry of inactive pages, and rate limiting on page lookups

