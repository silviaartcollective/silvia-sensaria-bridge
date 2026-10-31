import { arteloConfigStatus, testArteloConnection } from './artelo.mjs';
import { prodigiConfigStatus, testProdigiConnection } from './prodigi.mjs';
import { printShrimpConfigStatus, testPrintShrimpConnection } from './printshrimp.mjs';
import { printifyConfigStatus, testPrintifyConnection } from './printify.mjs';
import { gelatoConfigStatus, testGelatoConnection } from './gelato.mjs';
import { printfulConfigStatus, testPrintfulConnection, printfulLiveSubmissionEnabled } from './printful.mjs';
import { lumaprintsConfigStatus, testLumaprintsConnection, lumaprintsLiveSubmissionEnabled } from './lumaprints.mjs';
import { gootenConfigStatus, testGootenConnection, gootenLiveSubmissionEnabled } from './gooten.mjs';

export function podProviderStatus() {
  const masterSubmissionEnabled=String(process.env.FULFILLMENT_LIVE_SUBMISSION_ENABLED||'').toLowerCase()==='true';
  return {
    Sensaria: {
      ready: true,
      integration: 'Sensaria GO / CSV',
      apiCredentialRequired: false,
      liveSubmissionEnabled: false
    },
    Prodigi: {
      ...prodigiConfigStatus(),
      liveSubmissionEnabled: masterSubmissionEnabled && String(process.env.PRODIGI_FULFILLMENT_ENABLED || '').toLowerCase() === 'true'
    },
    Artelo: {
      ...arteloConfigStatus(),
      liveSubmissionEnabled: masterSubmissionEnabled && String(process.env.ARTELO_FULFILLMENT_ENABLED || '').toLowerCase() === 'true'
    },
    PrintShrimp: {
      ...printShrimpConfigStatus(),
      liveSubmissionEnabled: masterSubmissionEnabled && String(process.env.PRINTSHRIMP_FULFILLMENT_ENABLED || '').toLowerCase() === 'true'
    },
    Printify: {
      ...printifyConfigStatus(),
      liveSubmissionEnabled:
        String(process.env.FULFILLMENT_LIVE_SUBMISSION_ENABLED || '').toLowerCase() === 'true' &&
        String(process.env.PRINTIFY_FULFILLMENT_ENABLED || '').toLowerCase() === 'true'
    },
    Gelato: {
      ...gelatoConfigStatus(),
      liveSubmissionEnabled: masterSubmissionEnabled && String(process.env.GELATO_FULFILLMENT_ENABLED || '').toLowerCase() === 'true'
    },
    // Order submission for these three is not connected to any workflow yet.
    Printful: { ...printfulConfigStatus(), liveSubmissionEnabled: printfulLiveSubmissionEnabled(), orderSubmissionWorkflowConnected: false },
    Lumaprints: { ...lumaprintsConfigStatus(), liveSubmissionEnabled: lumaprintsLiveSubmissionEnabled(), orderSubmissionWorkflowConnected: false },
    Gooten: { ...gootenConfigStatus(), liveSubmissionEnabled: gootenLiveSubmissionEnabled(), orderSubmissionWorkflowConnected: false }
  };
}

export async function testPodProvider(provider) {
  const key = String(provider || '').trim().toLowerCase();
  if (key === 'prodigi') return { provider: 'Prodigi', ...(await testProdigiConnection()) };
  if (key === 'artelo') return { provider: 'Artelo', ...(await testArteloConnection()) };
  if (key === 'printshrimp') return { provider: 'PrintShrimp', ...(await testPrintShrimpConnection('CA')) };
  if (key === 'printify') return { provider: 'Printify', ...(await testPrintifyConnection()) };
  if (key === 'gelato') return { provider: 'Gelato', ...(await testGelatoConnection()) };
  if (key === 'printful') return { provider: 'Printful', ...(await testPrintfulConnection()) };
  if (key === 'lumaprints') return { provider: 'Lumaprints', ...(await testLumaprintsConnection()) };
  if (key === 'gooten') return { provider: 'Gooten', ...(await testGootenConnection()) };
  if (key === 'sensaria') {
    return { provider: 'Sensaria', ok: true, integration: 'Sensaria GO / CSV', apiCredentialRequired: false };
  }
  throw new Error('Unknown POD provider. Use sensaria, prodigi, artelo, printshrimp, printify, gelato, printful, lumaprints or gooten.');
}
