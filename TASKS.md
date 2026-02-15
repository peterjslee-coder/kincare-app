# KinCare Tasks

> **How this works:** Add bugs and features below as you find them. Don't worry about wording or order. When you're ready for a dev session, say "let's work the task list" and Claude will batch everything together into one efficient push. Nothing gets executed until you say go.

## Bugs

(none yet)


## Features — Batch 1: Role Foundation

> These establish the three user types and make them testable. Do these first — everything else builds on them.

- [ ] **Three user roles in UI:** Care Team (Pete + emergency contacts), Caretakers (Maria etc.), Cared-For (Betty). Navigation, dashboard, and visible features should adapt based on role.
- [ ] **Maria login (caretaker view):** Log in as Maria to see caretaker-side UI — set schedule availability, view upcoming assignments, manage messages with families. Placeholder pages for: miles driven, photo uploads. Build out UI for: arriving at appointment, logging work, leaving feedback ("Betty was a little distracted by the cats today"), and flagging options like "Request Coordination — New Health Concern noticed."
  - _Confirmed: Maria sees only families she's booked/assigned with._
  - _Add 2-3 other fictional local families Maria works for (to create scheduling complexity beyond just Pete's view). She's currently assigned to Betty + one other family._
  - _Include a static/notional map view of Blacksburg, VA with pins for Maria's assigned families. Placeholder for live mapping API integration later._
- [ ] **Betty login (cared-for view):** Log in as Betty with limited access — only sees what Pete enables (start with calendar of events only). Add a personal notes section where Betty can jot things for upcoming appointments (grocery list, doctor questions, etc.).
  - _Confirmed: Betty writes notes freely. Pete (primary care team contact) can edit for spelling/clarity. Caretakers can also see these notes before appointments._
- [ ] **Assigned caregivers clickable:** The "2 Assigned Caregivers" card on the dashboard should link to the Caregivers page. Make caregiver assignment selectable on the Caregivers page and reflect in real time on the dashboard.
- [ ] **Messaging groundwork:** Lay the backend foundation for in-app messaging now (database tables, API routes, basic message send/receive). This prepares for Batch 2+ when Pete's siblings get logins and need to coordinate with the care team. For now, wire it up between the three existing roles (Pete, Maria, Betty) so the Messages page is functional rather than mocked.

## Features — Batch 2: UI & Scheduling

> These layer on top of the role system from Batch 1.

- [ ] **Multiple emergency contacts:** Ability to add more than one emergency contact to a care profile. These contacts become part of the Care Team visually. Contact info only for now — no logins yet.
  - _Future: Add sibling logins (Pete's brother and sister) with generic credentials so they can see activity and use messaging. Build this when messaging is ready._
- [ ] **Calendar view with saturation shading:** Replace the upcoming appointments list with a calendar. Days with scheduled care are shaded blue — 1 hour = 25% saturation, scaling to 75% saturation + white text at 10+ hours. Goal: visual heat map of care intensity at a glance.
- [ ] **Favorite caretakers:** Mark caretakers as favorites for easier scheduling and weighted preference. Maria = first favorite for testing. Favorites influence default caregiver suggestions when booking.
- [ ] **Grey out past appointments:** Previous appointments appear greyed out but remain clickable to view result, cost, notes, and caretaker feedback.


## Demo Credentials

| Role | Email | Password | Notes |
|------|-------|----------|-------|
| Care Team | pete@kincare.app | kincare123 | Primary — manages Betty's care |
| Caretaker | maria@kincare.app | kincare123 | Assigned to Betty + 1 other family |
| Cared-For | betty@kincare.app | kincare123 | Limited view, controlled by Pete |


## Done
<!-- Completed items get moved here with [x] -->
