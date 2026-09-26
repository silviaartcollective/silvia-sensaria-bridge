import test from 'node:test';
import assert from 'node:assert/strict';
import { podProviderStatus, testPodProvider } from '../src/pod-providers.mjs';

test('POD provider registry exposes all Silvia providers without secrets', () => {
  const status = podProviderStatus();
  assert.deepEqual(Object.keys(status), ['Sensaria', 'Prodigi', 'Artelo', 'PrintShrimp', 'Printify']);
  assert.equal(status.Sensaria.integration, 'Sensaria GO / CSV');
  assert.equal(status.Sensaria.apiCredentialRequired, false);
  assert.equal(typeof status.Prodigi.ready, 'boolean');
  assert.equal(typeof status.Artelo.ready, 'boolean');
  assert.equal(typeof status.PrintShrimp.ready, 'boolean');
  assert.equal(typeof status.Printify.ready, 'boolean');
});

test('Sensaria provider test is local and read-only', async () => {
  const result = await testPodProvider('sensaria');
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'Sensaria');
  assert.equal(result.apiCredentialRequired, false);
});

test('unknown provider is rejected', async () => {
  await assert.rejects(() => testPodProvider('unknown'), /Unknown POD provider/);
});
