/**
 * Cache HTML/JSON fixtures from live ATS pages to the fixtures directory.
 * 
 * Usage:
 *   npx tsx src/__tests__/helpers/cache-fixtures.ts --refresh
 *   npx tsx src/__tests__/helpers/cache-fixtures.ts --refresh greenhouse   # only greenhouse
 * 
 * This fetches real pages and saves them for offline test usage.
 * Run this periodically to update fixtures if ATS page format changes.
 */

import * as fs from 'fs';
import * as path from 'path';

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');

interface FixtureSpec {
  parser: string;
  filename: string;
  url: string;
  type: 'html' | 'json';
  /** HTTP method — defaults to 'GET'. Use 'POST' for APIs that require it. */
  method?: 'GET' | 'POST';
  /** Request body for POST requests (sent as-is). */
  body?: string;
  /** Extra headers merged with the default User-Agent. */
  extraHeaders?: Record<string, string>;
}

const FIXTURES: FixtureSpec[] = [
  // Greenhouse — Remix SPA (new format)
  {
    parser: 'greenhouse',
    filename: 'hightouch.html',
    url: 'https://job-boards.greenhouse.io/hightouch',
    type: 'html',
  },
  // Greenhouse — EU domain, Remix SPA
  {
    parser: 'greenhouse',
    filename: 'nuitee.html',
    url: 'https://job-boards.eu.greenhouse.io/nuitee',
    type: 'html',
  },
  // Greenhouse — API JSON (with descriptions)
  {
    parser: 'greenhouse',
    filename: 'hightouch-api.json',
    url: 'https://boards-api.greenhouse.io/v1/boards/hightouch/jobs?content=true',
    type: 'json',
  },
  // Note: legacy-synthetic.html is hand-crafted, not fetched from a URL.
  // The legacy boards.greenhouse.io format (.opening class) has been
  // deprecated and all boards now redirect to job-boards.greenhouse.io (Remix).

  // SmartRecruiters — PolygonTechnology (API JSON, small board ~4 jobs)
  {
    parser: 'smartrecruiters',
    filename: 'polygon-api.json',
    url: 'https://api.smartrecruiters.com/v1/companies/PolygonTechnology/postings?limit=100&offset=0',
    type: 'json',
  },
  // SmartRecruiters — PolygonTechnology job detail (single posting)
  {
    parser: 'smartrecruiters',
    filename: 'polygon-job-detail.json',
    url: 'https://api.smartrecruiters.com/v1/companies/PolygonTechnology/postings/744000112031467',
    type: 'json',
  },
  // SmartRecruiters — PolygonTechnology HTML page (React SPA, mostly empty)
  {
    parser: 'smartrecruiters',
    filename: 'polygon.html',
    url: 'https://careers.smartrecruiters.com/PolygonTechnology',
    type: 'html',
  },
  // SmartRecruiters — Root page (should NOT be treated as a valid company board)
  {
    parser: 'smartrecruiters',
    filename: 'root-page.html',
    url: 'https://jobs.smartrecruiters.com/',
    type: 'html',
  },

  // Teamtailor — PayFit (custom domain, working)
  {
    parser: 'teamtailor',
    filename: 'payfit.html',
    url: 'https://careers.payfit.com/jobs',
    type: 'html',
  },
  {
    parser: 'teamtailor',
    filename: 'payfit-rss.xml',
    url: 'https://careers.payfit.com/jobs.rss?per_page=500',
    type: 'html', // RSS XML fetched as text
  },
  // Teamtailor — Doccla (custom domain, root page has no jobs)
  {
    parser: 'teamtailor',
    filename: 'doccla-root.html',
    url: 'https://careers.doccla.com/',
    type: 'html',
  },
  {
    parser: 'teamtailor',
    filename: 'doccla-jobs.html',
    url: 'https://careers.doccla.com/jobs',
    type: 'html',
  },
  {
    parser: 'teamtailor',
    filename: 'doccla-rss.xml',
    url: 'https://careers.doccla.com/jobs.rss?per_page=500',
    type: 'html', // RSS XML fetched as text
  },

  // YCombinator — Taktile (small board, ~5 jobs, S20 batch)
  {
    parser: 'ycombinator',
    filename: 'taktile.html',
    url: 'https://www.ycombinator.com/companies/taktile/jobs',
    type: 'html',
  },
  // YCombinator — DoorDash (bigger board, ~9 jobs, S13 batch)
  {
    parser: 'ycombinator',
    filename: 'doordash.html',
    url: 'https://www.ycombinator.com/companies/doordash/jobs',
    type: 'html',
  },
  // YCombinator — Taktile job detail page (has description)
  {
    parser: 'ycombinator',
    filename: 'taktile-job-detail.html',
    url: 'https://www.ycombinator.com/companies/taktile/jobs/g2XSHHS-senior-product-marketing-manager',
    type: 'html',
  },

  // Dynatrace — Coveo search proxy (POST, returns all open positions)
  {
    parser: 'dynatrace',
    filename: 'dynatrace-api.json',
    url: 'https://www.dynatrace.com/api/coveo/search/',
    type: 'json',
    method: 'POST',
    body: JSON.stringify({
      q: '',
      numberOfResults: 1000,
      wildcards: true,
      fieldsToInclude: [
        'team', 'office_locations', 'country', 'seniority',
        'flex_option', 'employment_type', 'job_id', 'region', 'capability',
      ],
      facets: [],
    }),
    extraHeaders: { 'Content-Type': 'application/json' },
  },

  // Picnic — custom Next.js SSR careers portal (all jobs in SSR HTML)
  {
    parser: 'picnic',
    filename: 'jobs.html',
    url: 'https://jobs.picnic.app/en/jobs',
    type: 'html',
  },

  // FREE NOW — Greenhouse API JSON (board slug: freenow, with descriptions)
  {
    parser: 'freenow',
    filename: 'freenow-api.json',
    url: 'https://boards-api.greenhouse.io/v1/boards/freenow/jobs?content=true',
    type: 'json',
  },

  // Eightfold — newer inline-JSON PCS/PCSX career pages
  {
    parser: 'eightfold',
    filename: 'ptc-careers.html',
    url: 'https://ptc.eightfold.ai/careers',
    type: 'html',
  },
  {
    parser: 'eightfold',
    filename: 'ptc-pcsx-page1.json',
    url: 'https://ptc.eightfold.ai/api/pcsx/search?domain=ptc.com&num_jobs=10&start=0&query=',
    type: 'json',
    extraHeaders: { Accept: 'application/json', Referer: 'https://ptc.eightfold.ai/careers' },
  },
  {
    parser: 'eightfold',
    filename: 'morganstanley-careers.html',
    url: 'https://morganstanley.eightfold.ai/careers',
    type: 'html',
  },
  {
    parser: 'eightfold',
    filename: 'morganstanley-pcsx-page1.json',
    url: 'https://morganstanley.eightfold.ai/api/pcsx/search?domain=morganstanley.com&num_jobs=10&start=0&query=',
    type: 'json',
    extraHeaders: { Accept: 'application/json', Referer: 'https://morganstanley.eightfold.ai/careers' },
  },
  {
    parser: 'eightfold',
    filename: 'telekom-growthhub-careers.html',
    url: 'https://telekom-growthhub.eightfold.ai/careers',
    type: 'html',
  },
  {
    parser: 'eightfold',
    filename: 'telekom-growthhub-pcsx-page1.json',
    url: 'https://telekom-growthhub.eightfold.ai/api/pcsx/search?domain=telekom-growthhub.com&num_jobs=10&start=0&query=',
    type: 'json',
    extraHeaders: { Accept: 'application/json', Referer: 'https://telekom-growthhub.eightfold.ai/careers' },
  },
  {
    parser: 'eightfold',
    filename: 'app-careers.html',
    url: 'https://app.eightfold.ai/careers',
    type: 'html',
  },
  {
    parser: 'eightfold',
    filename: 'app-pcsx-page1.json',
    url: 'https://app.eightfold.ai/api/pcsx/search?domain=volkscience.com&num_jobs=10&start=0&query=',
    type: 'json',
    extraHeaders: { Accept: 'application/json', Referer: 'https://app.eightfold.ai/careers' },
  },
  {
    parser: 'eightfold',
    filename: 'ngc-careers.html',
    url: 'https://ngc.eightfold.ai/careers',
    type: 'html',
  },
  {
    parser: 'eightfold',
    filename: 'ngc-pcsx-page1.json',
    url: 'https://ngc.eightfold.ai/api/pcsx/search?domain=ngc.com&num_jobs=10&start=0&query=',
    type: 'json',
    extraHeaders: { Accept: 'application/json', Referer: 'https://ngc.eightfold.ai/careers' },
  },
  {
    parser: 'eightfold',
    filename: 'netflix-careers.html',
    url: 'http://netflix.eightfold.ai/careers',
    type: 'html',
  },
  {
    parser: 'eightfold',
    filename: 'netflix-standard-page1.json',
    url: 'http://netflix.eightfold.ai/api/apply/v2/jobs?domain=netflix.com&num_jobs=10&start=0&query=',
    type: 'json',
    extraHeaders: { Accept: 'application/json', Referer: 'http://netflix.eightfold.ai/careers' },
  },

  // NEWWORK Software — WordPress REST API (jobs CPT; currently 0 published,
  // checked-in fixture is now a genuine live response)
  // This source is maintained in live-capture-settings/manual-sources.json:
  // {
  //   parser: 'newwork',
  //   filename: 'jobs-api.json',
  //   url: 'https://www.newwork.com/wp-json/wp/v2/jobs?per_page=100&_fields=id,title,link,content,excerpt,meta',
  //   type: 'json',
  // },

  // OTTO — Weblication CMS + SAP OData careers site
  // Note: The API requires a two-step session-based flow (create → fetch).
  // The fixture is the raw JSON response from the listing endpoint after session creation.
  // To refresh: create session with DE lang, then fetch AusschreibungSet.
  // See the otto parser test for the full API flow.
  {
    parser: 'otto',
    filename: 'jobsearch-en.html',
    url: 'https://www.otto.de/jobs/en/jobsearch/',
    type: 'html',
  },
  // otto-api-de.json and otto-api-en.json are manually cached since the API
  // requires cookie-based sessions that can't be done in a single curl/fetch.

  // Jobylon — WithSecure (company 505) v1 embed widget (JS with inline HTML)
  {
    parser: 'jobylon',
    filename: 'withsecure-embed.js',
    url: 'https://cdn.jobylon.com/jobs/companies/505/embed/v1/?page_size=100',
    type: 'html', // JS response fetched as text
  },
  // Jobylon — PwC Finland (company 502) v1 embed widget
  {
    parser: 'jobylon',
    filename: 'pwc-embed.js',
    url: 'https://cdn.jobylon.com/jobs/companies/502/embed/v1/?page_size=100',
    type: 'html', // JS response fetched as text
  },
  // Jobylon — WithSecure single job detail page (has JSON-LD)
  {
    parser: 'jobylon',
    filename: 'withsecure-job-detail.html',
    url: 'https://emp.jobylon.com/jobs/328902-withsecure-senior-sw-security-architect/',
    type: 'html',
  },
  // Jobylon — WithSecure company page (for detection testing)
  {
    parser: 'jobylon',
    filename: 'withsecure-company.html',
    url: 'https://emp.jobylon.com/companies/505/',
    type: 'html',
  },

  // d.vinci — CENIT listing page (small board, ~25 jobs)
  {
    parser: 'dvinci',
    filename: 'cenit-listing.html',
    url: 'https://cenit.dvinci-hr.com/en/jobs/iframe',
    type: 'html',
  },
  // d.vinci — Krones listing page (large board, ~260 jobs)
  {
    parser: 'dvinci',
    filename: 'krones-listing.html',
    url: 'https://krones.dvinci-hr.com/en/jobs/iframe',
    type: 'html',
  },
  // d.vinci — CENIT job detail page (has DvinciData + JSON-LD)
  {
    parser: 'dvinci',
    filename: 'cenit-job-detail.html',
    url: 'https://cenit.dvinci-hr.com/en/jobs/30513/digital-manufacturing-application-engineer-mfd',
    type: 'html',
  },

  // DYMATRIX — TYPO3 UdgJobs listing page 1 (~9 jobs per page)
  {
    parser: 'dymatrix',
    filename: 'listing-page1.html',
    url: 'https://www.dymatrix.de/de/unternehmen/stellenangebote',
    type: 'html',
  },
  // DYMATRIX — listing page 2
  {
    parser: 'dymatrix',
    filename: 'listing-page2.html',
    url: 'https://www.dymatrix.de/de/unternehmen/stellenangebote?tx_udgjobs_jobslist%5Bcontroller%5D=Jobs&tx_udgjobs_jobslist%5BcurrentPageNumber%5D=2',
    type: 'html',
  },
  // DYMATRIX — listing page 3
  {
    parser: 'dymatrix',
    filename: 'listing-page3.html',
    url: 'https://www.dymatrix.de/de/unternehmen/stellenangebote?tx_udgjobs_jobslist%5Bcontroller%5D=Jobs&tx_udgjobs_jobslist%5BcurrentPageNumber%5D=3',
    type: 'html',
  },
  // DYMATRIX — job detail page (Technical CSM)
  {
    parser: 'dymatrix',
    filename: 'detail-technical-csm.html',
    url: 'https://www.dymatrix.de/de/unternehmen/stellenangebote/details/technical-customer-success-manager-all-genders',
    type: 'html',
  },

  // Rohde & Schwarz — FirstSpirit CMS job board (paginated, 30 jobs/page)
  {
    parser: 'rohdeschwarz',
    filename: 'page-0.html',
    url: 'https://www.rohde-schwarz.com/de/karriere/stellenangebote/karriere-stellenangebote_251573.html?offset=0',
    type: 'html',
  },
  // Rohde & Schwarz — second page (offset=30)
  {
    parser: 'rohdeschwarz',
    filename: 'page-30.html',
    url: 'https://www.rohde-schwarz.com/de/karriere/stellenangebote/karriere-stellenangebote_251573.html?offset=30',
    type: 'html',
  },

  // Schwarz IT — Trinity CMS job search API (schwarz-digits.de)
  {
    parser: 'schwarzit',
    filename: 'schwarz-digits-api.json',
    url: 'https://schwarz-digits.de/en/api/v1/job/search',
    type: 'json',
    method: 'POST',
    body: '{"perPage":100,"page":1,"term":"","filters":{}}',
    extraHeaders: { 'Content-Type': 'application/json' },
  },
  // Schwarz IT — Trinity CMS job search HTML (schwarz-digits.de)
  {
    parser: 'schwarzit',
    filename: 'schwarz-digits.html',
    url: 'https://schwarz-digits.de/en/jobsearch?itemsPerPage=100',
    type: 'html',
  },
  // Schwarz Group — Trinity CMS job search API (jobs.schwarz)
  {
    parser: 'schwarzit',
    filename: 'jobs-schwarz-api.json',
    url: 'https://jobs.schwarz/en/api/v1/job/search',
    type: 'json',
    method: 'POST',
    body: '{"perPage":100,"page":1,"term":"","filters":{}}',
    extraHeaders: { 'Content-Type': 'application/json' },
  },

  // Workday — Mercedes-Benz Tech Innovation career page (Nuxt SPA, custom domain)
  {
    parser: 'workday',
    filename: 'mbti-career.html',
    url: 'https://www.mercedes-benz-techinnovation.com/en/career',
    type: 'html',
  },
  // Workday — MBTI CXS API response (first page, 20 jobs)
  {
    parser: 'workday',
    filename: 'mbti-api.json',
    url: 'https://mercedesbenztechinnovation.wd3.myworkdayjobs.com/wday/cxs/mercedesbenztechinnovation/MBTI_JOBPORTAL/jobs',
    type: 'json',
    method: 'POST',
    body: JSON.stringify({ limit: 20, offset: 0, searchText: '', appliedFacets: {} }),
    extraHeaders: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
  },
  // Workday — Zalando CXS API response (first page, 20 jobs)
  {
    parser: 'workday',
    filename: 'zalando-api.json',
    url: 'https://zalando.wd3.myworkdayjobs.com/wday/cxs/zalando/ZalandoSiteWD/jobs',
    type: 'json',
    method: 'POST',
    body: JSON.stringify({ limit: 20, offset: 0, searchText: '', appliedFacets: {} }),
    extraHeaders: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
  },

  // ── Getro — Unified VC talent board parser ──────────────────────────────────
  // Cherry VC — Afilio company page
  {
    parser: 'getro',
    filename: 'cherryvc-afilio.html',
    url: 'https://talent.cherry.vc/companies/afilio',
    type: 'html',
  },
  // Cherry VC — Afilio job detail (Getro v1 API, Senior Software Engineer)
  {
    parser: 'getro',
    filename: 'cherryvc-afilio-job-detail.json',
    url: 'https://api.getro.com/api/v1/jobs/72434174-senior-software-engineer-f-m-d?collection_id=44081',
    type: 'json',
    extraHeaders: { 'Accept': 'application/json' },
  },
  // Cherry VC — Manual job detail (Getro v1 API, Growth Marketing Manager)
  {
    parser: 'getro',
    filename: 'cherryvc-manual-job-detail.json',
    url: 'https://api.getro.com/api/v1/jobs/72172025-growth-marketing-manager?collection_id=44081',
    type: 'json',
    extraHeaders: { 'Accept': 'application/json' },
  },
  // HV Capital — Accessus company page
  {
    parser: 'getro',
    filename: 'hvcapital-accessus.html',
    url: 'https://hv.getro.com/companies/accessus',
    type: 'html',
  },
  // HV Capital — Accessus job detail (Getro v1 API, Frontend Engineer)
  {
    parser: 'getro',
    filename: 'hvcapital-accessus-job-detail.json',
    url: 'https://api.getro.com/api/v1/jobs/64706401-frontend-engineer?collection_id=234',
    type: 'json',
    extraHeaders: { 'Accept': 'application/json' },
  },
  // HV Capital — HV Capital job detail (Getro v1 API, Investment Intern)
  {
    parser: 'getro',
    filename: 'hvcapital-job-detail.json',
    url: 'https://api.getro.com/api/v1/jobs/72231928-investment-intern-early-stage?collection_id=234',
    type: 'json',
    extraHeaders: { 'Accept': 'application/json' },
  },
  // Earlybird — finmid company page
  {
    parser: 'getro',
    filename: 'earlybird-finmid.html',
    url: 'https://jobs.earlybird.com/companies/finmid',
    type: 'html',
  },
  // Earlybird — finmid job detail (Getro v1 API, Senior Associate)
  {
    parser: 'getro',
    filename: 'earlybird-finmid-job-detail.json',
    url: 'https://api.getro.com/api/v1/jobs/70530489-senior-associate-operations-regulatory-infrastructure?collection_id=617',
    type: 'json',
    extraHeaders: { 'Accept': 'application/json' },
  },
  // Play VC — Arya company page
  {
    parser: 'getro',
    filename: 'playvc-arya.html',
    url: 'https://careers.play.vc/companies/arya-2-7824848a-244e-4e51-acea-5f3f25c258e0',
    type: 'html',
  },
  // Play VC — Arya job detail (Getro v1 API, Founding Finance Associate)
  {
    parser: 'getro',
    filename: 'playvc-arya-job-detail.json',
    url: 'https://api.getro.com/api/v1/jobs/72043127-founding-finance-associate?collection_id=1624',
    type: 'json',
    extraHeaders: { 'Accept': 'application/json' },
  },
  // Femtech Insider — Tia company page
  {
    parser: 'getro',
    filename: 'femtechinsider-tia.html',
    url: 'https://jobs.femtechinsider.com/companies/tia',
    type: 'html',
  },
  // Femtech Insider — Tia job detail (Getro v1 API)
  {
    parser: 'getro',
    filename: 'femtechinsider-tia-job-detail.json',
    url: 'https://api.getro.com/api/v1/jobs/71959783-medical-assistant-williamsburg-on-site-full-time?collection_id=14612',
    type: 'json',
    extraHeaders: { 'Accept': 'application/json' },
  },
  // Protocol Labs — PL Job Board company page
  {
    parser: 'getro',
    filename: 'protocolai-pljobboard.html',
    url: 'https://jobs.protocol.ai/companies/pl-job-board',
    type: 'html',
  },
  // Protocol Labs — PL Job Board job detail (Getro v1 API)
  {
    parser: 'getro',
    filename: 'protocolai-pljobboard-job-detail.json',
    url: 'https://api.getro.com/api/v1/jobs/70490001-early-builder-group-ebg-programs-lead?collection_id=1336',
    type: 'json',
    extraHeaders: { 'Accept': 'application/json' },
  },
  // Note: Sitemap fixtures (cherryvc-sitemap.xml, hvcapital-sitemap.xml,
  // earlybird-sitemap.xml, playvc-sitemap.xml, femtechinsider-sitemap.xml,
  // protocolai-sitemap.xml) historically used trimmed manual samples; live captures are complete.
  // Re-cache by fetching from the live sitemaps if needed.

  // Personio corporate careers — JSON API (all open positions)
  // Historical assertions used synthetic samples; checked-in replacements are genuine live captures.
  {
    parser: 'personio',
    filename: 'personio-com-api.json',
    url: 'https://www.personio.com/api/careers/jobs/list/',
    type: 'json',
  },
];

// Live captures are not historical fixtures. Bounded, credential-free HTTP only.
const provenance: any[] = [];
const crypto = require('node:crypto');
const dns = require('node:dns/promises');
const net = require('node:net');
const SETTINGS_DIR = path.join(__dirname, 'live-capture-settings');
const EVIDENCE_DIR = path.join(__dirname, '..', '..', '..', 'live-capture-evidence');
if (!process.argv.includes('--refresh')) {
  console.error('Live network refresh is opt-in: pass --refresh. Normal tests use checked-in fixtures.');
  process.exit(2);
}
fs.mkdirSync(EVIDENCE_DIR, {recursive: true});
const allowed = new Set<string>(JSON.parse(fs.readFileSync(path.join(SETTINGS_DIR, 'allowed-hosts.json'), 'utf8')));
async function checkUrl(url: string) {
  const u = new URL(url);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || !allowed.has(u.hostname) || (u.port && !['80','443'].includes(u.port))) throw new Error('unapproved URL: '+url);
  if (net.isIP(u.hostname) || u.hostname === 'localhost') throw new Error('numeric/private URL target');
  const addresses = await dns.lookup(u.hostname, {all:true});
  for (const a of addresses) {
    const ip=a.address.replace(/^::ffff:/i,'');
    if (net.isIP(ip)===4 && /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) throw new Error('private address');
    if (net.isIP(ip)===6 && (/^(fc|fd|fe80)/i.test(ip) || ip==='::' || ip==='::1')) throw new Error('private address');
  }
}
async function fetchFixture(spec: FixtureSpec): Promise<void> {
  const record: any = {path: `${spec.parser}/${spec.filename}`, sourceUrl: spec.url, method: spec.method??'GET', capturedAt: new Date().toISOString(), source: 'genuine-live-web-not-historical', redirects: [], saved:false};
  provenance.push(record);
  try {
    let url=spec.url, method=spec.method??'GET', body=spec.body;
    let headers: Record<string,string> = {'User-Agent':'Mozilla/5.0 Jobscan-Fixture-Capture', ...(spec.extraHeaders??{})};
    // OTTO public anonymous session; cookie values are never recorded.
    if(spec.parser==='otto' && spec.filename==='otto-api-de.json') {
      const create='https://www.otto.de/or/sap/opu/odata/OTTO/OR2JB_SCONTEXT_SRV/create?ConsumerId=%27'+process.env.OTTO_CONSUMER+'%27&hash=%27%27&langu=%27DE%27&mediumId=%27'+process.env.OTTO_MEDIUM+'%27&sttag=%2720160223%27';
      await checkUrl(create);
      const session=await fetch(create,{headers,redirect:'manual',signal:AbortSignal.timeout(20000)});
      record.session={url:create,status:session.status};
      if(!session.ok) throw new Error('session HTTP '+session.status);
      headers.Cookie=session.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
      await session.body?.cancel();
    }
    let res: Response | undefined;
    for(let i=0;i<6;i++) {
      await checkUrl(url);
      res=await fetch(url,{method,body,headers,redirect:'manual',signal:AbortSignal.timeout(20000)});
      record.redirects.push({url,status:res.status,location:res.headers.get('location')});
      if([301,302,303,307,308].includes(res.status) && res.headers.get('location')) {
        const next=new URL(res.headers.get('location')!,url).href;
        if(new URL(next).origin!==new URL(url).origin) {delete headers.Cookie;}
        await res.body?.cancel();url=next;
        if(res.status===303 || ((res.status===301||res.status===302)&&method==='POST')) {method='GET';body=undefined;}
        continue;
      }
      break;
    }
    if(!res) throw new Error('no response');
    record.finalUrl=url;record.status=res.status;record.contentType=res.headers.get('content-type');
    const parts:Buffer[]=[];let count=0;
    if(res.body) for await(const part of res.body as any) {count+=part.length;if(count>8*1024*1024) throw new Error('8MiB response cap');parts.push(Buffer.from(part));}
    const bytes=Buffer.concat(parts);record.bytes=bytes.length;record.sha256=crypto.createHash('sha256').update(bytes).digest('hex');
    const text=bytes.toString('utf8');
    let valid=bytes.length>0;
    if(spec.filename.endsWith('.json')) {try{JSON.parse(text);}catch{valid=false;}}
    if(spec.filename.endsWith('.xml')) valid=valid && /^\s*(<\?xml|<rss|<urlset|<sitemapindex|<workzag-jobs)/i.test(text);
    if(spec.filename.endsWith('.html')) valid=valid && /<!doctype html|<html[\s>]/i.test(text);
    record.typeValid=valid;
    if(res.ok && valid) {const dest=path.join(FIXTURES_DIR,spec.parser,spec.filename);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);record.saved=true;}
    else {const dest=path.join(EVIDENCE_DIR,'failures',spec.parser,spec.filename);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);record.failureCapture=path.relative(path.dirname(EVIDENCE_DIR),dest);}
  } catch(e) {record.error=String(e);}
  fs.writeFileSync(path.join(EVIDENCE_DIR,'provenance.json'),JSON.stringify(provenance,null,2));
  console.log(JSON.stringify(record));
}
async function main() {
  const extra: FixtureSpec[] = JSON.parse(fs.readFileSync(path.join(SETTINGS_DIR,'manual-sources.json'),'utf8'));
  const only=process.env.ONLY_PATHS ? JSON.parse(process.env.ONLY_PATHS) as string[] : undefined;
  const merged=new Map([...FIXTURES,...extra].map(s=>[`${s.parser}/${s.filename}`,s]));
  const parser=process.argv.slice(2).find(a=>!a.startsWith('--'));
  const specs=[...merged.values()].filter(s=>(!only || only.includes(`${s.parser}/${s.filename}`)) && (!parser || s.parser===parser));
  let next=0;
  await Promise.all(Array.from({length:4},async()=>{while(next<specs.length) await fetchFixture(specs[next++]);}));
  const expected:string[]=JSON.parse(fs.readFileSync(path.join(SETTINGS_DIR,'expected.json'),'utf8'));
  const missing=expected.filter(p=>!fs.existsSync(path.join(FIXTURES_DIR,p)));
  console.log(JSON.stringify({attempted:specs.length,saved:provenance.filter(p=>p.saved).length,expected:expected.length,missing}));
  if(missing.length) process.exitCode=2;
}
main();
