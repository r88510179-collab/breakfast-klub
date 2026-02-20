# Breakfast Klub Tracker

This is a simple full-stack Next.js application for tracking sports bets for the Breakfast Klub. It includes authentication and a ledger for creating and viewing bets. The backend uses Supabase (Postgres + Auth) with row level security.

## Getting Started

### 1. Install dependencies

```
npm install
```

### 2. Configure environment variables

Copy `.env.local.example` to `.env.local` and fill in your Supabase project URL and anon key:

```
cp .env.local.example .env.local
```

Set the following values from your Supabase project settings:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 3. Run the development server

```
npm run dev
```

The app will be available at [http://localhost:3000](http://localhost:3000).

## Deployment

This app can be deployed on platforms like Vercel. Make sure to set the environment variables in your deployment settings.

## Notes

- The database schema and row level security policies should be created in your Supabase project (see the provided SQL in your instructions).
- The Supabase service role key is not needed for the client-side application but may be used in server-side functions.
