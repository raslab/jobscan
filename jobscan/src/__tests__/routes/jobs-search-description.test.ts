/**
 * Regression test for issue #10: full-text search must cover the stored JD
 * (description), not only the generated search_text column.
 *
 * Asserts buildJobWhere's WHERE clause contains a description condition in
 * all three search modes. Fails at base_sha (search only touched search_text),
 * passes after the fix. DB-free: only inspects the generated clause.
 */
import { buildJobWhere } from '../../db/pg';

const MODES = ['exact', 'fuzzy', 'regex'] as const;

describe('buildJobWhere description search (issue #10)', () => {
  for (const searchMode of MODES) {
    it(`${searchMode}: search clause includes the description column`, () => {
      const { clause, params } = buildJobWhere({ company: 'Boardwise GmbH', search: 'C#', searchMode });

      // The search term must still be parameterized against search_text...
      expect(clause).toContain('search_text');
      // ...and must ALSO fall back to the description column.
      expect(clause).toMatch(/description/);

      if (searchMode === 'regex') {
        expect(clause).toMatch(/COALESCE\(description,''\) ~\* \$\d+/);
      } else {
        expect(clause).toMatch(/LOWER\(COALESCE\(description,''\)\) LIKE \$\d+/);
      }

      // The literal term (lowercased for LIKE modes) is present in params.
      const expected = searchMode === 'regex' ? 'C#' : '%c#%';
      expect(params).toContain(expected);
    });
  }

  it('fuzzy: every word gets its own search_text OR description condition', () => {
    const { clause, params } = buildJobWhere({ search: 'C# TypeScript', searchMode: 'fuzzy' });
    const descConditions = clause.match(/LOWER\(COALESCE\(description,''\)\) LIKE \$\d+/g) ?? [];
    expect(descConditions).toHaveLength(2);
    expect(params).toContain('%c#%');
    expect(params).toContain('%typescript%');
  });

  it('no search term: clause has no description condition', () => {
    const { clause } = buildJobWhere({ company: 'Boardwise GmbH' });
    expect(clause).not.toMatch(/description/);
  });
});
