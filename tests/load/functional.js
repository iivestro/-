import http from 'k6/http';
import { check, sleep } from 'k6';

const base = 'https://sfaatbfiwwbvobpvhwxo.supabase.co';
const key = 'sb_publishable_CBPPwjIcmVbGK1fr8EHyYg_DlfldbK6';

http.setResponseCallback(http.expectedStatuses(200, 401, 403));

export const options = {
  vus: Number(__ENV.LOAD_VUS || 5),
  duration: __ENV.LOAD_DURATION || '30s',
  thresholds: {
    checks: ['rate==1'],
    http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '15s' }],
    http_req_duration: [{ threshold: 'p(95)<2000', abortOnFail: true, delayAbortEval: '15s' }],
  },
};

export default function () {
  const health = http.get(base + '/auth/v1/health', {
    headers: { apikey: key },
    redirects: 0,
    timeout: '10s',
  });
  check(health, { 'staging Auth health responds': (r) => r.status === 200 });

  const denied = http.get(base + '/rest/v1/doctors?select=id&limit=1', {
    headers: { apikey: key },
    redirects: 0,
    timeout: '10s',
  });
  check(denied, { 'anonymous directory read stays denied': (r) => r.status === 401 || r.status === 403 });
  sleep(2);
}
