import { arteloConfigStatus, testArteloConnection } from './artelo.mjs';
import { prodigiConfigStatus, testProdigiConnection } from './prodigi.mjs';
import { printShrimpConfigStatus, testPrintShrimpConnection } from './printshrimp.mjs';
import { printifyConfigStatus, testPrintifyConnection } from './printify.mjs';

export function podProviderStatus() {
  return {
    Sensaria: {
      ready: true,
      integration: 'Sensaria GO / CSV',
      apiCredentialRequired: false,
      liveSubmissionEnabled: false
    },
    Prodigi: {
      ...prodigiConfigStatus(),
      liveSubmissionEnabled: String(process.env.PRODIGI_FULFILLMENT_ENABLED || '').toLowerCase() === 'true'
    },
    Artelo: {
      ...arteloConfigStatus(),
      liveSubmissionEnabled: String(process.env.ARTELO_FULFILLMENT_ENABLED || '').toLowerCase() === 'true'
    },
    PrintShrimp: {
      ...printShrimpConfigStatus(),
      liveSubmissionEnabled: String(process.env.PRINTSHRIMP_FULFILLMENT_ENABLED || '').toLowerCase() === 'true'
    },
    Printify: {
      ...printifyConfigStatus(),
      liveSubmissionEnabled: false
    }
  };
}

export async function testPodProvider(provider) {
  const key = String(provider || '').trim().toLowerCase();
  if (key === 'prodigi') return { provider: 'Prodigi', ...(await testProdigiConnection()) };
  if (key === 'artelo') return { provider: 'Artelo', ...(await testArteloConnection()) };
  if (key === 'printshrimp') return { provider: 'PrintShrimp', ...(await testPrintShrimpConnection('CA')) };
  if (key === 'printify') return { provider: 'Printify', ...(await testPrintifyConnection()) };
  if (key === 'sensaria') {
    return { provider: 'Sensaria', ok: true, integration: 'Sensaria GO / CSV', apiCredentialRequired: false };
  }
  throw new Error('Unknown POD provider. Use sensaria, prodigi, artelo, printshrimp, or printify.');
}
