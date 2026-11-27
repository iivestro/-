import http from 'k6/http';
import { check, sleep } from 'k6';

const appUrl = 'https://iivestro.github.io/-/balsam-demo/';
const apiUrl = 'https://sfaatbfiwwbvobpvhwxo.supabase.co';
const apiKey = 'sb_publishable_CBPPwjIcmVbGK1fr8EHyYg_DlfldbK6';
const accessToken = __ENV.STAGING_PATIENT_ACCESS_TOKEN || '';

if (!accessToken) {
  throw new Error('Set STAGING_PATIENT_ACCESS_TOKEN to a temporary approved training-patient session token.');
}

export const options = {
  scenarios: {
    patient_read_journeys: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 25 },
        { duration: '30s', target: 50 },
        { duration: '30s', target: 100 },
        { duration: '60s', target: 100 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
      gracefulStop: '15s',
    },
  },
  thresholds: {
    checks: ['rate>0.99'],
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000'],
  },
};

const headers = {
  apikey: apiKey,
  Authorization: `Bearer ${accessToken}`,
  'Content-Type': 'application/json',
  'X-Load-Test-Run': 'staging-patient-read-journeys',
};

function readAction(action, data = {}) {
  const response = http.post(
    `${apiUrl}/rest/v1/rpc/patient_visit_action`,
    JSON.stringify({ p_action: action, p_data: data }),
    { headers, timeout: '10s', tags: { endpoint: `patient_visit_action:${action}` } },
  );
  check(response, { [`${action} RPC succeeds`]: (r) => r.status === 200 });
}

export default function () {
  const page = http.get(`${appUrl}patients.html`, { timeout: '10s', tags: { target: 'staging-patient-page' } });
  check(page, { 'staging patient page responds': (r) => r.status === 200 });

  readAction('visit_notifications');
  readAction('visit_reminders');
  readAction('nearby', { latitude: 33.3152, longitude: 44.3661 });
  readAction('queue_my');
  sleep(1);
}
