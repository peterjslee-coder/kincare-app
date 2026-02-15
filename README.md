# KinCare API v0.1

On-demand care coordination backend for the KinCare app.

## Quick Start

```bash
npm install
cp .env.example .env
npm run seed     # populate with demo data
npm start        # start on port 3001
```

Open http://localhost:3001/api to see all endpoints.

## Demo Login

```
Email:    pete@kincare.app
Password: kincare123
```

## API Endpoints

All authenticated routes require: `Authorization: Bearer <token>`

### Auth
- `POST /api/auth/register` — Create account (family or caregiver)
- `POST /api/auth/login` — Returns JWT token
- `GET /api/auth/me` — Current user profile

### Care Recipients
- `GET /api/care-recipients` — List your parents/care recipients
- `POST /api/care-recipients` — Add a care recipient
- `GET /api/care-recipients/:id` — Detail view
- `PUT /api/care-recipients/:id` — Update profile

### Care Sessions
- `GET /api/sessions` — List sessions (query: `?status=confirmed&from=2026-02-01`)
- `POST /api/sessions` — Create a care request
- `POST /api/sessions/:id/match` — Match a caregiver
- `PUT /api/sessions/:id/status` — Update status (confirm, start, complete, cancel)
- `GET /api/sessions/:id` — Session detail with visit log

### Caregivers
- `GET /api/caregivers` — Search (query: `?available=true&specialty=dementia`)
- `GET /api/caregivers/:id` — Profile + reviews
- `POST /api/caregivers/profile` — Create/update caregiver profile

### Activity Feed
- `GET /api/activity` — Notifications (query: `?unreadOnly=true`)
- `PUT /api/activity/:id/read` — Mark as read
- `PUT /api/activity/read-all` — Mark all as read
- `POST /api/activity/visit-log` — Caregiver submits visit notes

### Dashboard
- `GET /api/dashboard` — Aggregated stats, upcoming sessions, recent activity

## Tech Stack

- **Runtime:** Node.js + Express
- **Database:** SQLite via sql.js (zero native dependencies)
- **Auth:** JWT (jsonwebtoken + bcryptjs)
- **IDs:** UUIDs

## Project Structure

```
kincare-api/
├── src/
│   ├── server.js              # Express app + startup
│   ├── seed.js                # Demo data seeder
│   ├── models/
│   │   └── database.js        # SQLite schema + connection
│   ├── routes/
│   │   ├── auth.js            # Register, login, profile
│   │   ├── careRecipients.js  # Parent/care recipient CRUD
│   │   ├── sessions.js        # Care session booking + matching
│   │   ├── caregivers.js      # Caregiver search + profiles
│   │   ├── activity.js        # Activity feed + visit logs
│   │   └── dashboard.js       # Aggregated dashboard
│   └── middleware/
│       └── auth.js            # JWT authentication
├── package.json
└── .env.example
```

## Example: Book a Care Session

```bash
# 1. Login
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"pete@kincare.app","password":"kincare123"}' \
  | jq -r '.token')

# 2. Get care recipient ID
RECIPIENT=$(curl -s http://localhost:3001/api/care-recipients \
  -H "Authorization: Bearer $TOKEN" | jq -r '.careRecipients[0].id')

# 3. Create a care request
curl -s -X POST http://localhost:3001/api/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"careRecipientId\": \"$RECIPIENT\",
    \"serviceType\": \"meals\",
    \"scheduledDate\": \"2026-02-20\",
    \"scheduledTime\": \"12:00\",
    \"durationHours\": 2,
    \"specialInstructions\": \"Mom likes chicken soup\"
  }" | jq

# 4. Match a caregiver
SESSION_ID=<id from step 3>
curl -s -X POST http://localhost:3001/api/sessions/$SESSION_ID/match \
  -H "Authorization: Bearer $TOKEN" | jq
```

## Production Notes

This beta uses SQLite for simplicity. For production, migrate to PostgreSQL and add:
- Real-time notifications (WebSockets or SSE)
- Payment processing (Stripe Connect)
- Location-based caregiver matching (PostGIS)
- File uploads for visit photos (S3)
- Rate limiting and input validation
- Push notifications (Firebase)
