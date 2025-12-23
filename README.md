# Team Inbox

A collaborative email inbox platform for teams, similar to Front. Built with Next.js, Supabase, and Gmail API.

## Features (Phase 1)

- **Shared Email Inboxes**: Connect Gmail accounts and share them with your team
- **Real-time Presence**: See when teammates are viewing or drafting replies to the same thread
- **Collision Prevention**: Visual indicators show when someone else is composing a reply
- **Internal Comments**: Discuss threads with your team before responding to customers
- **Reply from App**: Send email replies directly from the interface

## Tech Stack

- **Frontend**: Next.js 14 (App Router), TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes
- **Database**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth
- **Email**: Gmail API via Google OAuth
- **Real-time**: Supabase Realtime

## Setup Instructions

### 1. Supabase Setup

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the contents of `supabase-schema.sql`
3. Go to **Settings > API** and copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` secret key → `SUPABASE_SERVICE_ROLE_KEY`

4. Go to **Authentication > Providers** and make sure Email is enabled

### 2. Google Cloud Setup (Gmail API)

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or select existing)
3. Enable the **Gmail API**:
   - Go to **APIs & Services > Library**
   - Search for "Gmail API" and enable it
4. Configure OAuth consent screen:
   - Go to **APIs & Services > OAuth consent screen**
   - Choose "External" user type
   - Fill in app name, support email, developer email
   - Add scopes:
     - `https://www.googleapis.com/auth/gmail.readonly`
     - `https://www.googleapis.com/auth/gmail.send`
     - `https://www.googleapis.com/auth/gmail.modify`
     - `https://www.googleapis.com/auth/userinfo.email`
     - `https://www.googleapis.com/auth/userinfo.profile`
   - Add test users (your email addresses)
5. Create OAuth credentials:
   - Go to **APIs & Services > Credentials**
   - Click **Create Credentials > OAuth client ID**
   - Choose "Web application"
   - Add authorized redirect URI: `http://localhost:3000/api/auth/google/callback`
   - Copy Client ID → `GOOGLE_CLIENT_ID`
   - Copy Client Secret → `GOOGLE_CLIENT_SECRET`

### 3. Environment Variables

Copy `.env.local.example` to `.env.local` and fill in all values:

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:
```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Google OAuth
GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 4. Run the App

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Usage

### First Time Setup

1. Sign up with your email at `/login`
2. Confirm your email (check inbox for Supabase confirmation)
3. Sign in
4. Click "Connect Gmail" in the sidebar
5. Authorize with your Google account
6. Click the sync button to pull emails from Gmail

### Daily Use

1. Select an inbox from the sidebar
2. Click a thread to view it
3. See presence indicators showing who else is viewing
4. Use "Team Discussion" section for internal comments
5. Click "Write a reply" to compose
6. Other teammates will see "drafting" indicator

## Architecture Notes

### Real-time Updates

The app uses Supabase Realtime to push updates for:
- New emails appearing in the thread list
- Presence changes (viewing/drafting)
- New internal comments

### Presence System

- When you open a thread, your status is set to "viewing"
- When you start typing a reply, status changes to "drafting"
- When you leave a thread or close the tab, presence is cleared
- Stale presence (older than 5 minutes) can be cleaned up via SQL function

### Security

- Row Level Security (RLS) ensures users can only access inboxes they're members of
- Google refresh tokens are stored in the database (consider encrypting in production)
- Service role key is only used server-side for accessing tokens

## Next Phases (Not Yet Implemented)

- **Phase 2**: SMS channel via Twilio
- **Phase 3**: WhatsApp channel
- **Phase 4**: Response templates
- **Phase 5**: Full role-based access control
- **Phase 6**: Email push notifications (webhooks from Gmail)

## Troubleshooting

### "No refresh token" error
Make sure you're using `prompt: 'consent'` in the OAuth URL and that you've revoked previous access at https://myaccount.google.com/permissions

### Emails not syncing
1. Check that the inbox has a valid refresh token
2. Look at browser console and server logs for errors
3. Ensure Gmail API is enabled in Google Cloud Console

### Presence not updating
1. Check Supabase Realtime is enabled for the tables
2. Verify the tables are added to `supabase_realtime` publication
3. Check browser console for WebSocket errors

## License

MIT
