# iPAi Kindred

Voice-first PWA for care recipients. Speaks in a familiar voice (cloned from a care team member) to deliver reminders, engage in conversation, and provide companionship.

## Architecture

This is **not** a separate app. It's a frontend that lives alongside the InPlace app and shares the same backend:

```
kincare-repo/
├── src/                          ← Shared backend (Railway)
│   ├── routes/
│   │   ├── ipaiChat.js           ← Existing iPAi chat (care team)
│   │   └── kindred.js            ← NEW: Kindred endpoints
│   └── utils/
│       ├── ipaiChat.js           ← Existing iPAi logic
│       ├── kindredBrain.js       ← NEW: Kindred conversation logic
│       └── voiceService.js       ← NEW: ElevenLabs/TTS abstraction
├── public/                       ← InPlace app frontend (care team)
└── kindred/                      ← THIS FOLDER: Kindred frontend (care recipient)
    ├── public/
    │   ├── index.html            ← Single-page PWA entry
    │   ├── manifest.json         ← PWA manifest
    │   ├── sw.js                 ← Service worker
    │   ├── css/
    │   │   └── kindred.css       ← Styles
    │   ├── js/
    │   │   ├── app.js            ← Main app logic
    │   │   ├── voice.js          ← Mic capture + audio playback
    │   │   └── api.js            ← Backend API calls
    │   ├── icons/                ← PWA icons
    │   └── audio/                ← Cached audio / offline fallbacks
    └── README.md                 ← You are here
```

## Key Principle

**The frontend is throwaway, the backend is permanent.**

All business logic, data, and service integrations live in `src/`. This `kindred/` folder is purely the voice UI. If Kindred ever merges into the main InPlace app, only this folder changes — the backend stays untouched.

## Backend Endpoints

All routes under `/api/kindred/`:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/kindred/chat` | POST | Send transcript, get text + audio response |
| `/api/kindred/reminders` | GET | Fetch today's reminders for care recipient |
| `/api/kindred/reminders` | POST | Care team creates a reminder (from InPlace app) |
| `/api/kindred/profile` | GET | Get active voice profile for care recipient |
| `/api/kindred/profiles` | POST | Create/update voice profile (voice cloning) |
| `/api/kindred/conversations` | GET | Conversation history |

## UI Spec

One screen. See the approved interactive mockup in the project root for reference.

## Status

Pre-build — folder structure and stubs only. See `VOICE_ASSISTANT_PROTOTYPE_ROADMAP.md` in the project root for the full plan.
