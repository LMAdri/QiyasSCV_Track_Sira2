'use strict';

const TRACKS = [
  'Web & Enterprise Application Development',
  'Graphics & Multimedia Design',
  'IT Infrastructure & System Support',
  'Digital Device & System Support',
  'AI Integrated Digital Marketing',
];

const CAMPUSES = [
  { name: 'Selam', city: 'Addis Ababa' },
  { name: 'Lemi-Kura', city: 'Addis Ababa' },
  { name: 'Misrak PTC', city: 'Addis Ababa' },
  { name: 'Tegbared PTC', city: 'Addis Ababa' },
  { name: 'Nefas-Silk PTC', city: 'Addis Ababa' },
  { name: 'Arada', city: 'Addis Ababa' },
  { name: 'Teferi-Mekonnen PTC', city: 'Addis Ababa' },
  { name: 'Dessie-Wro Sehen', city: 'Dessie' },
  { name: 'Hossana PTC', city: 'Hossana' },
];

const EDUCATION = [
  'High school drop out',
  'University drop out',
  "Bachelor's degree",
  'TVET Level 1',
  'TVET Level 2',
  'TVET Level 3',
  'TVET Level 4',
  'TVET Level 5',
  'Short term certificate',
  'Other',
];

const STATUSES = [
  { id: 1, label: 'Currently unemployed & searching for job' },
  { id: 2, label: 'Applied for job position / sent CV' },
  { id: 3, label: 'Scheduled for interview / exam' },
  { id: 4, label: 'Interviewed / took exam' },
  { id: 5, label: 'Failed the job interview / job exam' },
  { id: 6, label: 'Passed the job interview / exam & waiting for offer' },
  { id: 7, label: 'Currently secured job / got employment letter (employed recently)' },
  { id: 8, label: 'Declined the job offer' },
  { id: 9, label: 'Already actively working / employed previously' },
  { id: 10, label: 'Currently self-employed & started company' },
];

const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.id, s.label]));
STATUS_LABEL[0] = 'Not yet reported';

// Statuses that carry which optional fields
const SALARY_STATUSES = [7, 9];
const COMPANY_STATUSES = [2, 3, 4, 5, 6, 7, 8, 9, 10];
const OFFER_LETTER_STATUS = 7;

module.exports = {
  TRACKS, CAMPUSES, EDUCATION, STATUSES, STATUS_LABEL,
  SALARY_STATUSES, COMPANY_STATUSES, OFFER_LETTER_STATUS,
  CAMPUS_NAMES: CAMPUSES.map((c) => c.name),
  TVET_LEVELS: EDUCATION.filter((e) => e.startsWith('TVET')),
  BACHELORS: "Bachelor's degree",
};
