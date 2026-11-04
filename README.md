# Clipnova

> Upload once. Get scroll-stopping shorts in minutes.

Multi-tenant SaaS that turns long-form videos into short-form clip suggestions. This is the **first vertical slice**: accounts, uploads, async processing, AI transcription, AI highlight detection and a clip review/editor. It now also renders and exports the clips (see below).

## What works in this slice

- Email/password sign-up with email verification and password reset; optional Google OAuth (button appears when configured)
- Workspaces (one default per user) with roles: Owner, Editor, Viewer, Platform admin (`User.isPlatformAdmin`)
- Projects scoped strictly to the workspace; rename, duplicate, archive/restore, delete (Owner only)
- Upload MP4/MOV/WEBM/MKV with real progress, enforced size limit (streamed, never buffered in memory) and duration limit
- Async pipeline (BullMQ worker): ffprobe -> FFmpeg audio extraction -> Groq Whisper (segment + word timestamps) -> Groq LLM highlight detection
- Strict clip validation: negative times, end <= start, < 10 s, > 90 s and beyond-duration clips are rejected; heavy overlaps are dropped; the model only returns data and never runs commands
- Retry on transient failures (3 attempts, exponential backoff) with user-facing error messages; manual retry for failed projects
- Review page: video player with clip timeline, per-clip editing (times, 15/30/45/60 s presets, title, hook, caption text, caption position/size/colors/background, reframing mode, aspect), select/deselect, caption preview, transcript viewing and editing, regenerate suggestions
- Rendering: a separate BullMQ queue/worker renders one MP4 per selected clip with FFmpeg (cut, center / manual / blurred-background reframing to 1080x1920, 1080x1350 or 1080x1080, word-highlighted captions and a hook burned in via ASS subtitles). Each render snapshots the clip when queued, so edits made afterwards never change it; writes go to a `.part` file and are renamed on success
- Downloads: per-clip MP4 and a "Download all" ZIP via HMAC-signed links that expire after 10 minutes (the review page refreshes them); rendered files are deleted after `RENDER_RETENTION_DAYS`
- Credits: 1 credit per uploaded video (`DEFAULT_CREDITS` per new workspace)

## Not built yet

- Speaker/face-aware auto-cropping (manual and center crop only)
- Cloud object storage (S3/R2). Source videos and renders are on local disk behind `src/lib/storage.ts`, and download links are signed app URLs rather than provider presigned URLs, so moving to S3/R2 means swapping the storage driver and the download routes
- Import by public URL, project expiry job, billing, admin UI
- Credit refunds when processing fails after upload

## Setup

Requires Node 20+, Docker (for Postgres and Redis), and FFmpeg + ffprobe on the machine running the worker.

```bash
cp .env.example .env        # set NEXTAUTH_SECRET and GROQ_API_KEY at minimum
docker compose up -d        # Postgres + Redis
npm install
npx prisma db push          # or: npx prisma migrate dev
npm run dev                 # web app on http://localhost:3000
npm run worker              # in a second terminal
```

Set `REQUIRE_EMAIL_VERIFICATION="false"` for local dev if you do not want to configure email. With no `RESEND_API_KEY`, verification and reset links are printed to the web server console.

The same environment variables must be present when running `npm run build`.

To make an account a platform admin: `UPDATE "User" SET "isPlatformAdmin" = true WHERE email = '...';`

## Tests

```bash
npm test
```

Covers clip validation and LLM-output parsing, caption (ASS) generation, URL signing and the ZIP writer.

Rendering needs FFmpeg built with libass and libx264 (standard builds have both) and the Inter font installed for the intended caption look; FFmpeg falls back to another font if it is missing.

## Layout

```
prisma/schema.prisma     data model (users, workspaces, projects, transcripts, clips)
src/lib/clips/           pure clip validation (unit tested)
src/lib/groq.ts          Whisper + highlight prompts
src/lib/ffmpeg.ts        ffprobe / audio extraction (execFile, no shell)
src/lib/rbac.ts          workspace-scoped access control
src/app/api/             auth, projects, upload, video streaming, clips, transcript
worker/index.ts          BullMQ processing pipeline
```

## Security notes

- Passwords hashed with bcrypt (cost 12); verification/reset tokens are random, single-use, expire, and only their SHA-256 hash is stored
- Registration and password-reset responses do not reveal whether an email exists; auth endpoints are rate limited (in-memory, replace with Redis when running multiple web instances)
- Uploaded filenames are never used in paths; only whitelisted extensions are accepted; FFmpeg is invoked with argument arrays, not a shell
- The transcript is treated as untrusted input in the LLM prompt
- Video streaming is auth-checked and workspace-scoped
"# Clipnova" 
