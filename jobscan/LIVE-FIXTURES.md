# Repository-owned genuine live fixtures

Normal fixture loading is filesystem-only and uses the checked-in `src/__tests__/fixtures/` assets. There is no default download hook. Full integration tests retain their original network behavior; no tests, assertions or application parsers were changed.

These October 12, 2026 captures are raw complete public-source response bodies, not historical or synthetic originals. `live-fixture-provenance.json` records source/final URL, timestamp, HTTP method/status, redirects, bytes and SHA256. Complete live sitemaps are not trimmed. Alternative live vacancies/company boards retain loader filenames without pretending their content matches historical titles/entities. `PRDs/fixture-storage/FIXTURE-PRD.json` defines the eight-field scoped specification; SHA256: `6b1834eacd2436d710d27fe106af5718d6e20d244541c5b039a41c88711d7c44`.

## Explicit maintenance refresh

From the `jobscan` directory, after installing dependencies:

```sh
OTTO_CONSUMER=9814723 OTTO_MEDIUM=2740 npx tsx src/__tests__/helpers/cache-fixtures.ts --refresh
# Optional parser filter:
npx tsx src/__tests__/helpers/cache-fixtures.ts --refresh greenhouse
# Optional exact relative paths:
ONLY_PATHS='["dvinci/krones-listing.html"]' npx tsx src/__tests__/helpers/cache-fixtures.ts --refresh
```

Without `--refresh` the downloader exits 2 before any network request. Settings are resolved relative to the helper, not the current working directory. Capture evidence is written to `jobscan/live-capture-evidence/`; HTTP error bodies go to its `failures/` directory and are never installed as valid job fixtures. Existing valid fixtures are not replaced by failed requests. Inspect refreshed evidence and update the tracked provenance only after verifying hashes and scope; a refresh does not automatically certify the committed provenance manifest.

The downloader uses four workers, 20-second request bounds, six redirect responses, 8MiB response limits, explicit related public-host approval and private-address rejection. Anonymous OTTO session cookies are not logged. These are bounded acquisition safeguards, not immutable DNS-rebinding protection. Exit 2 means required paths remain missing, not success. Settings permit direct approved related redirect services. The public `careers.ptc.com` alternative failed DNS resolution; original Eightfold PTC endpoints returned 404.

## Preserved failures and acceptance

Failure bodies are recorded in the provenance manifests (`failureCapture` paths in `live-fixture-provenance.json`) but are intentionally **not committed**: this PR adds only test fixtures, not temporary intermediate capture data. The manifest records retain HTTP404 status even when the body parses as HTML/JSON, and the recorded paths point at the capture workspace's evidence directory rather than tracked repository files. One intermediate retry's failure bodies were not archived due to an evidence-path packaging defect; its raw recorded metadata remains and original/final responses are retained separately. The evidence path was corrected before the final candidate, then exercised in a fresh sandbox.

69 of 76 expected paths are captured and verified. Remaining seven: PTC HTML/API; Protocol Labs company HTML/sitemap (approved redirects followed, final404); Hightouch HTML/API and legacy synthetic filename (final404). No missing response was reconstructed.

Unchanged real website schema/data-drift test failures are explicitly allowed **only for this fixture-storage PR** and must be reported as failing, never green or normal PR_READY. Missing captures and introduced fixture packaging/code regressions are not waived. Required exact-candidate unit/full/build/MCP evidence and independent fixture-only review precede parent publication. No historical-restoration or assertion/parser migration approval is required for this scoped deliverable.
