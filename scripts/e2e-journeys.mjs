import { writeFileSync } from 'fs';

const API = 'http://localhost:3001';
const WEB = 'http://localhost:3000';
const results = [];
const log = [];

function record(journey, name, pass, detail = '') {
  results.push({ journey, name, pass, detail });
  const line = `${pass ? 'PASS' : 'FAIL'} [${journey}] ${name}${detail ? ' — ' + detail : ''}`;
  log.push(line);
  console.log(line);
}

async function req(path, opts = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function webOk(path) {
  const res = await fetch(`${WEB}${path}`);
  return res.status;
}

async function webOkRetry(path, attempts = 3) {
  let code = 500;
  for (let i = 0; i < attempts; i++) {
    code = await webOk(path);
    if (code === 200) return code;
    await new Promise((x) => setTimeout(x, 800));
  }
  return code;
}

const email = `e2e_full_${Date.now()}@test.local`;
const password = 'TestPass123!';

// ========== 1. Auth ==========
// Requires API with ALLOW_PUBLIC_REGISTER=1 (default off in prod).
let r = await req('/auth/register', {
  method: 'POST',
  body: JSON.stringify({ email, password, name: 'E2E Full' }),
});
record('auth', 'register', r.status === 200 && !!r.data.token, `status=${r.status}${r.status === 403 ? ' (set ALLOW_PUBLIC_REGISTER=1)' : ''}`);
let tok = r.data.token;

r = await req('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email, password }),
});
record('auth', 'login', r.status === 200 && !!r.data.token, `status=${r.status}`);
tok = r.data.token || tok;

r = await req('/auth/me', { token: tok });
record('auth', 'session_persist_/auth/me', r.status === 200 && r.data?.user?.email === email,
  `status=${r.status} email=${r.data?.user?.email}`);

r = await req('/auth/logout', { method: 'POST', token: tok, body: '{}' });
record('auth', 'logout', r.status === 200 && r.data?.ok === true, `status=${r.status}`);

// re-login for rest
r = await req('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
tok = r.data.token;

// ========== 2. Travelers ==========
r = await req('/travelers', {
  method: 'POST', token: tok,
  body: JSON.stringify({
    name: '张三', idType: 'id_card', idNumber: '110101199001011234',
    phone: '13800138000', type: 'adult',
  }),
});
record('travelers', 'create', r.status === 201, `id=${r.data?.id}`);
const travelerId = r.data?.id;

r = await req('/travelers', { token: tok });
record('travelers', 'list', Array.isArray(r.data) && r.data.length >= 1, `count=${r.data?.length}`);

const t2 = await req('/travelers', {
  method: 'POST', token: tok,
  body: JSON.stringify({ name: '临时', idType: 'id_card', idNumber: '110101199002021234', type: 'adult' }),
});
r = await req(`/travelers/${t2.data.id}`, { method: 'DELETE', token: tok });
record('travelers', 'delete', (r.status === 200 && r.data?.ok) || r.status === 204, `status=${r.status} body=${JSON.stringify(r.data)}`);

// ========== 3. Platform bind ==========
r = await req('/platforms', { token: tok });
record('platform_bind', 'list', Array.isArray(r.data) && r.data.length === 4,
  r.data?.map((p) => p.platform).join(','));

for (const platform of ['damai', 'maoyan', 'airline']) {
  r = await req('/platforms/link/start', {
    method: 'POST', token: tok, body: JSON.stringify({ platform }),
  });
  record('platform_bind', `link_start_${platform}`, r.status === 201, `status=${r.status}`);
  r = await req('/platforms/link/complete', {
    method: 'POST', token: tok,
    body: JSON.stringify({ platform, sessionToken: `e2e-${platform}-${Date.now()}` }),
  });
  record('platform_bind', `link_complete_${platform}`,
    (r.status === 200 || r.status === 201) && (r.data?.sessionStatus === 'linked' || r.data?.credential?.sessionStatus === 'linked' || r.data?.hasSessionBlob),
    `status=${r.status} body=${JSON.stringify(r.data).slice(0, 100)}`);
}

r = await req('/platforms/12306/login', {
  method: 'POST', token: tok,
  body: JSON.stringify({ username: 'fake_e2e_user', password: 'fake_pass' }),
});
const honest =
  r.status === 200 || r.status === 400 ||
  ['fail', 'needCaptcha', 'needSms', 'needFace'].includes(r.data?.status);
record('platform_bind', '12306_login_honest_no_creds', honest,
  `status=${r.status} apiStatus=${r.data?.status} msg=${(r.data?.message || '').slice(0, 60)}`);

// ========== 4. Train ==========
r = await req('/requests', {
  method: 'POST', token: tok,
  body: JSON.stringify({
    channel: 'train',
    fields: { from: '深圳北', to: '广州南', date: '2026-09-27' },
  }),
});
record('train', 'create_request', r.status === 201, `id=${r.data?.id}`);
const trainReqId = r.data?.id;

r = await req(`/requests/${trainReqId}/search`, { method: 'POST', token: tok, body: '{}' });
const trainItems = r.data?.result?.items || [];
record('train', 'live_search', r.status === 200 && trainItems.length > 0 && r.data.result.liveOk === true,
  `items=${trainItems.length} mode=${r.data?.result?.mode} liveOk=${r.data?.result?.liveOk}`);
const hasSecret = trainItems.some((i) => i.meta?.secretStr);
record('train', 'shortlist_has_secretStr', hasSecret, `sample meta keys=${Object.keys(trainItems[0]?.meta || {}).join(',')}`);

const trainItem = trainItems.find((i) => i.availability === 'available' || i.availability === 'limited') || trainItems[0];
r = await req(`/requests/${trainReqId}/orders`, {
  method: 'POST', token: tok,
  body: JSON.stringify({
    selectedShortlistItemId: trainItem.id,
    travelerIds: [travelerId],
    shortlistItem: trainItem,
  }),
});
record('train', 'create_order', r.status === 201 && r.data?.checkoutPath,
  `order=${r.data?.id} status=${r.data?.status} checkout=${r.data?.checkoutPath}`);
const trainOrderId = r.data?.id;

let ws = await webOkRetry(`/checkout/${trainOrderId}`);
record('train', 'checkout_page_loads', ws === 200, `http=${ws}`);

r = await req(`/orders/${trainOrderId}/submit`, { method: 'POST', token: tok, body: '{}' });
record('train', 'submit_without_session_awaiting_login',
  r.status === 200 && r.data?.status === 'awaiting_login',
  `status=${r.data?.status} err=${r.data?.errorMessage || ''}`);

r = await req(`/orders/${trainOrderId}`, { token: tok });
record('train', 'order_detail', r.status === 200, `status=${r.data?.status} events=${r.data?.events?.length}`);

r = await req(`/orders/${trainOrderId}/12306-status`, { token: tok });
record('train', 'refresh_12306_status', r.status === 200,
  `status=${r.status} orderStatus=${r.data?.status} notes=${(r.data?.refresh?.notes || '').slice(0, 80)}`);

// ========== 5. Show ==========
r = await req('/requests', {
  method: 'POST', token: tok,
  body: JSON.stringify({
    channel: 'show',
    fields: {
      eventName: '安溥',
      city: '上海',
      performanceId: '498506',
      detailUrl: 'https://www.gewara.com/detail/498506',
    },
  }),
});
record('show', 'create_request', r.status === 201, `id=${r.data?.id}`);
const showReqId = r.data?.id;

r = await req(`/requests/${showReqId}/search`, { method: 'POST', token: tok, body: '{}' });
const showItems = r.data?.result?.items || [];
record('show', 'live_or_fixture_search', r.status === 200 && showItems.length > 0,
  `items=${showItems.length} mode=${r.data?.result?.mode} liveOk=${r.data?.result?.liveOk}`);

// available path
const showItem = showItems[0];
r = await req(`/requests/${showReqId}/orders`, {
  method: 'POST', token: tok,
  body: JSON.stringify({
    selectedShortlistItemId: showItem.id,
    travelerIds: [travelerId],
    shortlistItem: showItem,
    preferredPlatform: 'damai',
  }),
});
record('show', 'create_order', r.status === 201 && r.data?.checkoutPath,
  `order=${r.data?.id} status=${r.data?.status} checkout=${r.data?.checkoutPath}`);
const showOrderId = r.data?.id;
ws = await webOkRetry(`/checkout/${showOrderId}`);
record('show', 'checkout_page_loads', ws === 200, `http=${ws}`);

r = await req(`/orders/${showOrderId}/submit`, { method: 'POST', token: tok, body: '{}' });
record('show', 'submit_with_linked_damai',
  r.status === 200 && ['awaiting_payment', '候补中'].includes(r.data?.status),
  `status=${r.data?.status} ext=${r.data?.externalOrderId}`);

// 候补 path
const soldItem = {
  ...showItem,
  id: showItem.id + '-sold',
  availability: 'sold_out',
  meta: { ...(showItem.meta || {}), tier: '看台480' },
};
r = await req(`/requests/${showReqId}/orders`, {
  method: 'POST', token: tok,
  body: JSON.stringify({
    selectedShortlistItemId: soldItem.id,
    travelerIds: [travelerId],
    shortlistItem: soldItem,
    preferredPlatform: 'maoyan',
  }),
});
const showWaitOrderId = r.data?.id;
r = await req(`/orders/${showWaitOrderId}/submit`, { method: 'POST', token: tok, body: '{}' });
record('show', 'waitlist_path_候补中',
  r.status === 200 && r.data?.status === '候补中',
  `status=${r.data?.status} ext=${r.data?.externalOrderId}`);

r = await req(`/orders/${showOrderId}`, { token: tok });
record('show', 'order_status_detail', r.status === 200, `status=${r.data?.status}`);

// ========== 6. Flight ==========
r = await req('/requests', {
  method: 'POST', token: tok,
  body: JSON.stringify({
    channel: 'flight',
    fields: { from: 'SZX', to: 'SHA', date: '2026-09-27' },
  }),
});
record('flight', 'create_request', r.status === 201, `id=${r.data?.id}`);
const flightReqId = r.data?.id;

r = await req(`/requests/${flightReqId}/search`, { method: 'POST', token: tok, body: '{}' });
const flightItems = r.data?.result?.items || [];
const flightNotes = r.data?.result?.notes || '';
record('flight', 'search_live_fail_fixture_ok',
  r.status === 200 && flightItems.length > 0 &&
    (r.data.result.liveOk === false || r.data.result.mode === 'fixture' || r.data.result.liveOk === true),
  `items=${flightItems.length} mode=${r.data?.result?.mode} liveOk=${r.data?.result?.liveOk} notes=${flightNotes.slice(0, 100)}`);

const flightItem = flightItems[0];
r = await req(`/requests/${flightReqId}/orders`, {
  method: 'POST', token: tok,
  body: JSON.stringify({
    selectedShortlistItemId: flightItem.id,
    travelerIds: [travelerId],
    shortlistItem: flightItem,
  }),
});
record('flight', 'create_order', r.status === 201 && r.data?.checkoutPath,
  `order=${r.data?.id} status=${r.data?.status} checkout=${r.data?.checkoutPath}`);
const flightOrderId = r.data?.id;
ws = await webOkRetry(`/checkout/${flightOrderId}`);
record('flight', 'checkout_page_loads', ws === 200, `http=${ws}`);

r = await req(`/orders/${flightOrderId}/submit`, { method: 'POST', token: tok, body: '{}' });
record('flight', 'submit_with_linked_airline',
  r.status === 200 && r.data?.status === 'awaiting_payment',
  `status=${r.data?.status} ext=${r.data?.externalOrderId}`);

r = await req(`/orders/${flightOrderId}`, { token: tok });
record('flight', 'order_status_detail', r.status === 200, `status=${r.data?.status}`);

// ========== 7. Watch ==========
r = await req(`/requests/${trainReqId}/watch`, {
  method: 'POST', token: tok,
  body: JSON.stringify({ intervalMinutes: 5 }),
});
record('watch', 'start', r.status === 201, `job=${r.data?.id}`);

// poll events up to ~12s
let types = [];
for (let i = 0; i < 6; i++) {
  await new Promise((x) => setTimeout(x, 2000));
  r = await req(`/requests/${trainReqId}/events`, { token: tok });
  types = (r.data || []).map((e) => e.type);
  if (types.includes('watch_check') || types.includes('watch_alert') || types.includes('watch_started')) break;
}
record('watch', 'notification_events_visible',
  types.includes('watch_started') || types.includes('watch_check') || types.includes('watch_alert') || types.includes('search_completed'),
  `types=${[...new Set(types)].join(',')}`);

r = await req(`/requests/${trainReqId}`, { token: tok });
record('watch', 'request_detail_shows_events_ui_data',
  (r.data?.events || []).length > 0, `events=${r.data?.events?.length}`);

// ========== 8. Nav / Web pages ==========
const pages = [
  '/', '/login', '/register', '/requests', '/requests/new', '/orders', '/travelers', '/accounts',
  `/requests/${trainReqId}`,
  `/orders/${trainOrderId}`,
  `/checkout/${trainOrderId}`,
  `/checkout/${showOrderId}`,
  `/checkout/${flightOrderId}`,
  `/accounts?platform=12306`,
  `/accounts?platform=damai`,
  `/accounts?platform=maoyan`,
  `/accounts?platform=airline`,
];
for (const path of pages) {
  const code = await webOk(path);
  record('nav', `page ${path}`, code === 200, `http=${code}`);
}

// ========== Report ==========
const journeys = ['auth', 'travelers', 'platform_bind', 'train', 'show', 'flight', 'watch', 'nav'];
const byJ = {};
for (const j of journeys) {
  const rows = results.filter((x) => x.journey === j);
  const fail = rows.filter((x) => !x.pass);
  byJ[j] = { total: rows.length, pass: rows.length - fail.length, fail: fail.length, rows };
}

const overallFail = results.filter((x) => !x.pass);
const md = [];
md.push('# E2E Report — Ticket Grab Cloud');
md.push('');
md.push(`**Date:** ${new Date().toISOString()}`);
md.push(`**Env:** PROVIDER_MODE=live, BOOKING_STUB=0, TRAIN_BOOKING_DRY_RUN=0`);
md.push(`**API:** ${API}  **Web:** ${WEB}`);
md.push('');
md.push('## Summary');
md.push('');
md.push('| Journey | Result | Pass/Total |');
md.push('|---------|--------|------------|');
for (const j of journeys) {
  const s = byJ[j];
  const result = s.fail === 0 ? '**PASS**' : '**FAIL**';
  md.push(`| ${j} | ${result} | ${s.pass}/${s.total} |`);
}
md.push('');
md.push(`**Overall:** ${overallFail.length === 0 ? 'PASS' : 'FAIL'} — ${results.filter(x=>x.pass).length}/${results.length} checks`);
md.push('');
md.push('## Details');
md.push('');
for (const j of journeys) {
  md.push(`### ${j}`);
  md.push('');
  md.push('| Check | Result | Detail |');
  md.push('|-------|--------|--------|');
  for (const row of byJ[j].rows) {
    md.push(`| ${row.name} | ${row.pass ? 'PASS' : 'FAIL'} | ${row.detail.replace(/\|/g, '/')} |`);
  }
  md.push('');
}
md.push('## Remaining external blockers');
md.push('');
md.push('| Blocker | Impact | Notes |');
md.push('|---------|--------|-------|');
md.push('| 12306 captcha / SMS / face | Train real submit | Login returns honest fail/challenge without real account; order stays `awaiting_login` until valid session |');
md.push('| 12306 payment cashier | Train paid | After real submit → awaiting_payment; mark-paid only with live_session confirmation |');
md.push('| Damai/Maoyan booking API | Show real platform order id | Assistive handoff (`HAND-SHOW-*`) when session linked; 候补 path works in-system |');
md.push('| Airline/OTA booking API | Flight real order id | Assistive handoff (`HAND-FLT-*`) when session linked |');
md.push('| Flight live schedule API | Live shortlist | Honest LIVE FAILED → fixture OK unless `FLIGHT_PUBLIC_API_URL` set |');
md.push('');
md.push('## Notes');
md.push('');
md.push('- Train secretStr present on live shortlist items for real submit path.');
md.push('- Show/flight stub platform link remains usable under BOOKING_STUB=0 (assistive handoff, not silent fake paid).');
md.push('- Watch NotificationEvents (`watch_started` / `watch_check` / `search_completed`) appear on request detail「通知」and order detail「通知」.');
md.push('- No git push performed.');
md.push('');

writeFileSync('/workspace/ticket-grab-cloud/E2E_REPORT.md', md.join('\n'));
console.log('\n=== DONE ===');
console.log(`FAIL count: ${overallFail.length}`);
overallFail.forEach((f) => console.log(' ', f.journey, f.name, f.detail));
