# Fresh fixture capture replay

These are genuine live captures from October 12, 2026, not historical or synthetic fixture originals. `live-fixture-provenance.json` records original/final URLs, redirects, HTTP status, byte count, capture time and SHA256. Valid type/hash does not imply legacy assertion compatibility.

The amended `src/__tests__/helpers/cache-fixtures.ts` is a diagnostic sandbox downloader: four workers, 20-second requests, at most six HTTP responses per redirect chain, 8MiB per body, hostname approval and nonzero exit when any of the 76 required paths remains absent. Its current diagnostic configuration reads `/home/coder/{manual-sources,allowed-hosts,expected}.json` and writes evidence under `/home/coder`. Copies of those three JSON files are under `src/__tests__/helpers/live-capture-settings/` for replay. The controller diagnostic uploads them; no credentials are used. OTTO requires the public constant environment values `OTTO_CONSUMER=9814723 OTTO_MEDIUM=2740` for anonymous session creation. Session cookie values are not logged. `ONLY_PATHS` optionally limits attempts to a JSON array of relative fixture paths.

Failure-response bodies are retained separately by the controller, never staged as working fixtures. Full sitemaps were not trimmed. Personio's genuine XML is not the Acme Corp synthetic sample expected by historical assertions. All application parsers and test assertions remain unchanged. Further assertion/parser repair requires an owner-approved PRD.

Acquisition checks ran on the exact baseline plus the downloaded fixture bytes and sandbox downloader overlay. The final local fixture commit was created afterward; no claim of candidate-pinned independent review is made.
