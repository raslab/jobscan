import * as fs from 'fs';
import * as path from 'path';

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');

/**
 * Load a cached fixture file for a given parser.
 * @param parser - Parser name (subdirectory under fixtures/)
 * @param filename - Filename within the parser's fixture directory
 * @returns File content as string
 *
 * @example
 *   const html = loadFixture('greenhouse', 'hightouch.html');
 *   const json = loadFixture('greenhouse', 'hightouch-api.json');
 */
export function loadFixture(parser: string, filename: string): string {
  const filePath = path.join(FIXTURES_DIR, parser, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Fixture not found: ${parser}/${filename}\n` +
      `Expected at: ${filePath}\n` +
      `Restore the checked-in fixture from the approved repository revision. ` +
      `Live refresh is opt-in and must be reviewed; tests never download fixtures.`
    );
  }
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Load and parse a JSON fixture file.
 */
export function loadJsonFixture<T = unknown>(parser: string, filename: string): T {
  return JSON.parse(loadFixture(parser, filename)) as T;
}

/**
 * List all fixture files for a parser.
 */
export function listFixtures(parser: string): string[] {
  const dir = path.join(FIXTURES_DIR, parser);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir);
}
