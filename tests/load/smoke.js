import http from 'k6/http';
import { check, sleep } from 'k6';
const base = 'https://sfaatbfiwwbvobpvhwxo.supabase.co';
export const options = { vus: 10, duration: '1m', thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<500'] } };
export default function () {
  const r = http.get(base + '/auth/v1/health', { headers: { apikey: __ENV.STAGING_ANON_KEY }, redirects: 0, timeout: '10s' });
  check(r, { 'auth health responds': x => x.status === 200 });
  sleep(2);
}
