import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JOBSCAN_URL = 'http://jobscan.test';

const { registerCrmTools } = await import('../dist/crm.js');

function createServerHarness() {
  const tools = new Map();
  return {
    server: {
      tool(name, _description, _schema, _metadata, handler) {
        tools.set(name, handler);
      },
    },
    getTool(name) {
      const tool = tools.get(name);
      assert.ok(tool, `Expected tool ${name} to be registered`);
      return tool;
    },
  };
}

test('jobscan_crm_funnel calls analytics endpoint and preserves filters', async () => {
  const fetchCalls = [];
  globalThis.fetch = async (url) => {
    fetchCalls.push(url);
    return {
      ok: true,
      json: async () => ({ ok: true }),
    };
  };

  const harness = createServerHarness();
  registerCrmTools(harness.server);

  const handler = harness.getTool('jobscan_crm_funnel');
  const result = await handler({
    company: 'Acme',
    title: 'Engineer',
    location: 'Remote',
    search: 'platform',
  });

  assert.equal(fetchCalls.length, 1);
  assert.equal(
    fetchCalls[0],
    'http://jobscan.test/api/crm/analytics/funnel?company=Acme&title=Engineer&location=Remote&search=platform',
  );
  assert.deepEqual(result, {
    content: [{ type: 'text', text: '{\n  "ok": true\n}' }],
  });
});
