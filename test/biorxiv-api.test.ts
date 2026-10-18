import { errorMessage } from "../src/academic/errors.ts";
import type { Raw } from "../src/academic/types.ts";
// bioRxiv/medRxiv client: paging, early stop, and — the part that matters —
// telling "the API declined" apart from "nothing matched".
//
//   node test/biorxiv-api.test.ts
//
// Uses a stubbed fetch so it runs offline and does not add load to a host that
// has no search endpoint and pages 100 records at a time.

const B = new URL('../src/', import.meta.url).href;
const { fetchWindow, BiorxivUnavailableError } = await import(B + 'academic/sources/_biorxiv-api.ts');

let pass = 0, fail = 0;
const check = (name: Raw, ok: Raw, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};

const realFetch = globalThis.fetch;
const stub = (handler: Raw) => { globalThis.fetch = handler; };
const restore = () => { globalThis.fetch = realFetch; };

const PAGE = 30; // the API serves 30 records per cursor call

const page = (n: Raw, server: Raw, total: number | null = null) => ({
  ok: true,
  text: async () => JSON.stringify({
    messages: [{ status: 'ok', count: n, total: total == null ? String(n) : String(total) }],
    collection: Array.from({ length: n }, (_, i) => ({
      title: `${server} preprint ${i}`, abstract: 'sepsis prediction machine learning icu', doi: `10.1101/x${i}`,
    })),
  }),
});

// 1. Empty 200 on the first page must throw, not look like an empty result set.
stub(async () => ({ ok: true, text: async () => '' }));
try {
  await fetchWindow({ server: 'medrxiv', startDate: '2026-01-01', endDate: '2026-02-01', maxPages: 3 });
  check('empty 200 is reported as unavailable', false, 'no error thrown');
} catch (e) {
  check('empty 200 is reported as unavailable', e instanceof BiorxivUnavailableError, errorMessage(e));
}

// 2. A window no larger than one page needs exactly one request.
let calls = 0;
stub(async () => { calls++; return page(PAGE, 'medrxiv', PAGE); });
let out = await fetchWindow({ server: 'medrxiv', startDate: '2026-03-01', endDate: '2026-04-01', maxPages: 5 });
check('single-page window costs one request', out.length === PAGE && calls === 1, `${out.length} records in ${calls} calls`);

// 2b. A large window is walked in from the NEWEST end, not forward from the
//     oldest — reading forward only ever surfaces the start of the window.
calls = 0;
const cursors: Raw = [];
stub(async (url: Raw) => {
  calls++;
  cursors.push(Number(String(url).match(/\/(\d+)\/json$/)![1]));
  return page(PAGE, 'medrxiv', 74191);
});
await fetchWindow({ server: 'medrxiv', startDate: '2022-01-01', endDate: '2026-12-31', maxPages: 3 });
check('walks in from the newest records', cursors[0] === 0 && cursors[1] === 74191 - PAGE && cursors[2] === 74191 - 2 * PAGE,
      `cursors ${cursors.join(', ')}`);

// 3. `enough` stops the walk early — the point of the cap.
calls = 0;
stub(async () => { calls++; return page(PAGE, 'biorxiv', 74191); });
out = await fetchWindow({
  server: 'biorxiv', startDate: '2026-05-01', endDate: '2026-06-01', maxPages: 5,
  enough: (records: Raw) => records.length >= PAGE,
});
check('stops early once enough is collected', calls === 1, `${calls} call(s)`);

// 4. Every page goes through the supplied scheduler, so the rate limiter sees
//    each request rather than one burst per search.
calls = 0;
let scheduled = 0;
stub(async () => { calls++; return page(PAGE, 'medrxiv', 74191); });
await fetchWindow({
  server: 'medrxiv', startDate: '2026-07-01', endDate: '2026-08-01', maxPages: 3,
  schedule: (fn: Raw) => { scheduled++; return fn(); },
});
check('each page is scheduled', scheduled === calls && scheduled === 3, `${scheduled} scheduled / ${calls} fetched`);

// 5. A failure after the first page keeps what was already collected.
calls = 0;
stub(async () => { calls++; if (calls === 1) return page(PAGE, 'medrxiv', 74191); return { ok: true, text: async () => '' }; });
out = await fetchWindow({ server: 'medrxiv', startDate: '2026-09-01', endDate: '2026-10-01', maxPages: 4 });
check('partial window survives a later failure', out.length === PAGE, `${out.length} records`);

restore();
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
