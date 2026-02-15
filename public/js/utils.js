const { useState, useEffect, useRef } = React;
const API_BASE = window.location.origin;

let AUTH_TOKEN = null;
const setAuthToken = window.setAuthToken = (token) => {
  AUTH_TOKEN = token;
  if (token) localStorage.setItem('auth_token', token);
  else localStorage.removeItem('auth_token');
};

const apiFetch = window.apiFetch = async (url, options = {}) => {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (AUTH_TOKEN) headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  const response = await fetch(API_BASE + url, { ...options, headers });
  if (response.status === 401) { setAuthToken(null); return null; }
  return response;
};

// Caregiver Availability Data (simulated)
const CAREGIVER_AVAILABILITY = window.CAREGIVER_AVAILABILITY = {
  'Maria Santos': {
    skills: ['Dementia Care', 'Meal Prep', 'Companionship', 'Medication Reminders'],
    rate: '$30/hr',
    weeklySchedule: {
      'Mon': [{ start: '8:00 AM', end: '4:00 PM' }],
      'Tue': [{ start: '8:00 AM', end: '2:00 PM' }],
      'Wed': [{ start: '10:00 AM', end: '6:00 PM' }],
      'Thu': [{ start: '8:00 AM', end: '4:00 PM' }],
      'Fri': [{ start: '8:00 AM', end: '12:00 PM' }],
      'Sat': [],
      'Sun': [],
    },
    bookedSlots: [
      { date: '2026-02-16', start: '10:00 AM', end: '12:00 PM', client: 'Betty Lee' },
      { date: '2026-02-17', start: '8:00 AM', end: '10:00 AM', client: 'Another Client' },
      { date: '2026-02-18', start: '2:00 PM', end: '4:00 PM', client: 'Betty Lee' },
      { date: '2026-02-19', start: '8:00 AM', end: '11:00 AM', client: 'Another Client' },
    ],
  },
  'Sarah Chen': {
    skills: ['Meal Prep', 'Companionship', 'Light Housekeeping', 'Personal Care'],
    rate: '$28/hr',
    weeklySchedule: {
      'Mon': [{ start: '9:00 AM', end: '5:00 PM' }],
      'Tue': [{ start: '9:00 AM', end: '5:00 PM' }],
      'Wed': [],
      'Thu': [{ start: '9:00 AM', end: '3:00 PM' }],
      'Fri': [{ start: '9:00 AM', end: '5:00 PM' }],
      'Sat': [{ start: '10:00 AM', end: '2:00 PM' }],
      'Sun': [],
    },
    bookedSlots: [
      { date: '2026-02-16', start: '9:00 AM', end: '11:00 AM', client: 'Another Client' },
      { date: '2026-02-20', start: '1:00 PM', end: '3:00 PM', client: 'Betty Lee' },
    ],
  },
  'James Okafor': {
    skills: ['Companionship', 'Transportation', 'Health & Wellness', 'Errands'],
    rate: '$32/hr',
    weeklySchedule: {
      'Mon': [{ start: '7:00 AM', end: '3:00 PM' }],
      'Tue': [{ start: '7:00 AM', end: '3:00 PM' }],
      'Wed': [{ start: '7:00 AM', end: '3:00 PM' }],
      'Thu': [],
      'Fri': [{ start: '7:00 AM', end: '1:00 PM' }],
      'Sat': [{ start: '8:00 AM', end: '12:00 PM' }],
      'Sun': [],
    },
    bookedSlots: [
      { date: '2026-02-17', start: '7:00 AM', end: '9:00 AM', client: 'Betty Lee' },
      { date: '2026-02-18', start: '11:00 AM', end: '1:00 PM', client: 'Another Client' },
    ],
  },
};

// Helper: get next 7 days starting from today
const getNextSevenDays = window.getNextSevenDays = () => {
  const days = [];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push({
      date: d.toISOString().split('T')[0],
      dayName: dayNames[d.getDay()],
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dayNames[d.getDay()],
      shortDate: `${d.getMonth() + 1}/${d.getDate()}`,
    });
  }
  return days;
};

// Helper: generate available time slots for a caregiver on a given day
const getAvailableSlots = window.getAvailableSlots = (caregiverName, dayInfo) => {
  const avail = CAREGIVER_AVAILABILITY[caregiverName];
  if (!avail) return [];
  const daySchedule = avail.weeklySchedule[dayInfo.dayName] || [];
  if (daySchedule.length === 0) return [];

  const slots = [];
  daySchedule.forEach(block => {
    const parseTime = (t) => {
      const [time, ampm] = t.split(' ');
      let [h, m] = time.split(':').map(Number);
      if (ampm === 'PM' && h !== 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      return h * 60 + m;
    };
    const startMin = parseTime(block.start);
    const endMin = parseTime(block.end);
    for (let m = startMin; m + 60 <= endMin; m += 60) {
      const h = Math.floor(m / 60);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
      const slotStart = `${displayH}:00 ${ampm}`;
      const endH = Math.floor((m + 60) / 60);
      const endAmpm = endH >= 12 ? 'PM' : 'AM';
      const displayEndH = endH > 12 ? endH - 12 : endH === 0 ? 12 : endH;
      const slotEnd = `${displayEndH}:00 ${endAmpm}`;

      const isBooked = (avail.bookedSlots || []).some(b => {
        if (b.date !== dayInfo.date) return false;
        const bStart = parseTime(b.start);
        const bEnd = parseTime(b.end);
        return m < bEnd && (m + 60) > bStart;
      });

      slots.push({ start: slotStart, end: slotEnd, booked: isBooked, startMin: m });
    }
  });
  return slots;
};

// Helper: check if caregiver has matching skills for a service type
const caregiverMatchesService = window.caregiverMatchesService = (caregiverName, serviceType) => {
  const avail = CAREGIVER_AVAILABILITY[caregiverName];
  if (!avail) return false;
  const serviceMap = {
    'companionship': ['Companionship'],
    'personal_care': ['Personal Care'],
    'housekeeping': ['Light Housekeeping', 'Housekeeping'],
    'meal_prep': ['Meal Prep'],
    'transportation': ['Transportation', 'Errands'],
    'health_wellness': ['Health & Wellness', 'Medication Reminders'],
  };
  const matchSkills = serviceMap[serviceType] || [];
  return avail.skills.some(s => matchSkills.some(ms => s.toLowerCase().includes(ms.toLowerCase())));
};
