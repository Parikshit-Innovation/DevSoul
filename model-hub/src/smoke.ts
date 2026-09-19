import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelHubConfig } from './models.ts';
import { ProviderAdapter } from './adapters.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runSmokeTest() {
  console.log('='.repeat(78));
  console.log('🔬 DEVOS MODEL HUB & ROUTER — LIVE SMOKE TEST');
  console.log('='.repeat(78));

  const configPath = path.resolve(__dirname, '..', 'models.config.json');
  let config: ModelHubConfig;
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    config = JSON.parse(raw);
  } catch (err: any) {
    console.error(`❌ Failed to read models.config.json: ${err.message}`);
    process.exit(1);
  }

  const adapter = new ProviderAdapter();
  const openRouterApiKey = process.env.OPENROUTER_API_KEY || '';
  const openRouterBaseUrl = adapter.getOpenRouterBaseUrl();
  const ollamaBaseUrl = adapter.getOllamaBaseUrl();

  console.log(`\n1. Provider Configuration & Environment:`);
  console.log(`   • OpenRouter Endpoint: ${openRouterBaseUrl}`);
  console.log(`   • OpenRouter API Key:  ${openRouterApiKey ? '✓ SET (' + openRouterApiKey.substring(0, 8) + '...)' : '⚠️ NOT SET (Cloud live calls will be skipped)'}`);
  console.log(`   • Ollama Endpoint:      ${ollamaBaseUrl}`);

  // -------------------------------------------------------------------------
  // 1. Live Discovery: OpenRouter
  // -------------------------------------------------------------------------
  console.log(`\n2. Querying OpenRouter Live Catalog (GET ${openRouterBaseUrl}/models)...`);
  const openRouterResult = await adapter.fetchOpenRouterAvailableModels();
  let liveOpenRouterModels: string[] = [];

  if (openRouterResult.success) {
    liveOpenRouterModels = openRouterResult.models;
    console.log(`   ✅ OpenRouter is REACHABLE. Catalog size: ${liveOpenRouterModels.length} models.`);
  } else {
    console.log(`   ⚠️ OpenRouter query skipped/failed: ${openRouterResult.error}`);
  }

  // -------------------------------------------------------------------------
  // 2. Live Discovery: Ollama
  // -------------------------------------------------------------------------
  console.log(`\n3. Querying Local Ollama Instance (GET ${ollamaBaseUrl}/api/tags)...`);
  const ollamaResult = await adapter.fetchOllamaAvailableModels();
  let liveOllamaModels: string[] = [];

  if (ollamaResult.success) {
    liveOllamaModels = ollamaResult.models;
    console.log(`   ✅ Ollama is RUNNING. Locally pulled models (${liveOllamaModels.length}): [${liveOllamaModels.join(', ') || 'none'}]`);
  } else {
    console.log(`   ⚠️ Ollama is NOT reachable: ${ollamaResult.error}`);
    console.log(`      (Hint: Start Ollama locally with 'ollama serve' if you wish to run local inference)`);
  }

  // -------------------------------------------------------------------------
  // 3. Catalog Cross-Check: FOUND vs MISSING
  // -------------------------------------------------------------------------
  console.log(`\n4. Catalog Audit (models.config.json vs Live Providers):`);
  const openRouterSet = new Set(liveOpenRouterModels.map((m) => m.toLowerCase().trim()));
  const ollamaSet = new Set(liveOllamaModels.map((m) => m.toLowerCase().trim()));

  for (const model of config.models) {
    const remoteNorm = model.remoteName.toLowerCase().trim();
    if (model.provider === 'openrouter') {
      if (!openRouterResult.success) {
        console.log(`   • [${model.id}] ${model.displayName} (${model.remoteName}) -> ⚠️ UNVERIFIED (OpenRouter offline/no key)`);
      } else {
        const found = openRouterSet.has(remoteNorm) || openRouterSet.has(remoteNorm.split(':')[0]);
        if (found) {
          console.log(`   • [${model.id}] ${model.displayName} (${model.remoteName}) -> ✅ FOUND in live OpenRouter catalog`);
        } else {
          console.log(`   • [${model.id}] ${model.displayName} (${model.remoteName}) -> ❌ MISSING from OpenRouter catalog`);
        }
      }
    } else if (model.provider === 'ollama') {
      if (!ollamaResult.success) {
        console.log(`   • [${model.id}] ${model.displayName} (${model.remoteName}) -> ⚠️ UNVERIFIED (Ollama not running)`);
      } else {
        const found =
          ollamaSet.has(remoteNorm) ||
          Array.from(ollamaSet).some((o) => o.startsWith(remoteNorm) || o.startsWith(remoteNorm.split(':')[0]));
        if (found) {
          console.log(`   • [${model.id}] ${model.displayName} (${model.remoteName}) -> ✅ FOUND in local Ollama tags`);
        } else {
          console.log(`   • [${model.id}] ${model.displayName} (${model.remoteName}) -> ⚠️ NOT PULLED in local Ollama (run: ollama pull ${model.remoteName})`);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 4. Live Chat Verification (Tiny Completion)
  // -------------------------------------------------------------------------
  console.log(`\n5. Live Chat Completion Verification:`);

  // Cloud Live Test
  if (openRouterResult.success && openRouterApiKey) {
    const cloudTestModel = config.models.find((m) => m.provider === 'openrouter' && m.enabled);
    if (cloudTestModel) {
      console.log(`   Executing live cloud test with ${cloudTestModel.id} (${cloudTestModel.remoteName})...`);
      try {
        const res = await adapter.executeChat(cloudTestModel, [
          { role: 'user', content: 'Reply with the single word "READY".' },
        ], 10000);
        console.log(`   ✅ Cloud Live Chat SUCCESS in ${res.latencyMs}ms: "${res.content.trim()}"`);
      } catch (err: any) {
        console.log(`   ❌ Cloud Live Chat failed: ${err.message}`);
      }
    }
  } else {
    console.log(`   [Cloud] Skipped live chat completion (OPENROUTER_API_KEY not configured).`);
  }

  // Local Live Test
  if (ollamaResult.success && liveOllamaModels.length > 0) {
    const pulledLocalModel = config.models.find(
      (m) => m.provider === 'ollama' && m.enabled && liveOllamaModels.some((lm) => lm.includes(m.remoteName.split(':')[0]))
    );
    if (pulledLocalModel) {
      console.log(`   Executing live local test with ${pulledLocalModel.id} (${pulledLocalModel.remoteName})...`);
      try {
        const res = await adapter.executeChat(pulledLocalModel, [
          { role: 'user', content: 'Reply with the single word "LOCAL_OK".' },
        ], 15000);
        console.log(`   ✅ Local Live Chat SUCCESS in ${res.latencyMs}ms: "${res.content.trim()}"`);
      } catch (err: any) {
        console.log(`   ❌ Local Live Chat failed: ${err.message}`);
      }
    } else {
      console.log(`   [Local] Ollama is running, but none of the configured models are pulled yet.`);
    }
  } else {
    console.log(`   [Local] Skipped live chat completion (Ollama not running locally).`);
  }

  console.log('\n' + '='.repeat(78));
  console.log('🔬 SMOKE TEST COMPLETE');
  console.log('='.repeat(78));
}

runSmokeTest().catch(console.error);
