import http from 'k6/http';
import { check, sleep } from 'k6';

const appUrl = 'https://iivestro.github.io/-/';
const apiUrl = 'https://oejkeqlqkwdfropylxsv.supabase.co';
const apiKey = 'sb_publishable_Ue8nsJFsLpDLFUgSTB24cw_rckeqWag';

http.setResponseCallback(http.expectedStatuses(200, 401, 403));

export const options = {
  scenarios: {
    visitors: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 200 },
        { duration: '45s', target: 500 },
        { duration: '45s', target: 1000 },
        { duration: '90s', target: 1000 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
      gracefulStop: '15s',
    },
  },
  thresholds: {
    checks: ['rate>0.99'],
    http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '30s' }],
    http_req_duration: [{ threshold: 'p(95)<2000', abortOnFail: true, delayAbortEval: '30s' }],
  },
};

export default function () {
  const page = http.get(appUrl, { tags: { target: 'github-pages' }, timeout: '10s' });
  check(page, { 'production landing page responds': (r) => r.status === 200 });

  const auth = http.get(apiUrl + '/auth/v1/health', {
    headers: { apikey: apiKey, 'X-Load-Test-Run': 'capacity-15k-readonly' },
    tags: { target: 'supabase-auth-health' },
    redirects: 0,
    timeout: '10s',
  });
  check(auth, { 'production Auth health responds': (r) => r.status === 200 });

  if (__ITER % 10 === 0) {
    const privateDirectory = http.get(apiUrl + '/rest/v1/doctors?select=id&limit=1', {
      headers: { apikey: apiKey, 'X-Load-Test-Run': 'capacity-15k-readonly' },
      tags: { target: 'anon-read-denial' },
      redirects: 0,
      timeout: '10s',
    });
    check(privateDirectory, {
      'anonymous directory read remains blocked': (r) => r.status === 401 || r.status === 403,
    });
  }

  sleep(20);
}
