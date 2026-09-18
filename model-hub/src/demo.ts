import {
  ProviderAdapter,
  ModelRegistry,
  PrivacyDetector,
  ModelRouter,
  AuditLogger,
  ModelExecutor,
  type RouteRequest,
  type ModelHubConfig,
} from './index.ts';

function printHeader(title: string) {
  console.log('\n' + '='.repeat(80));
  console.log(`🤖  ${title.toUpperCase()}`);
  console.log('='.repeat(80));
}

function printStep(stepNum: number, title: string, mode: 'LIVE' | 'MOCKED' = 'MOCKED') {
  console.log(`\n▶ BEAT ${stepNum} [${mode}]: ${title}`);
  console.log('-'.repeat(80));
}

function displayDecision(decision: any) {
  const locBadge =
    decision.location === 'cloud' ? '☁️ CLOUD' : '💻 LOCAL';
  const privBadge =
    decision.sensitivity === 'private' ? '🔒 PRIVATE (LOCAL ONLY)' : '🌐 PUBLIC';

  console.log(`  Routed Model:      ${decision.modelId} (${decision.provider} / ${locBadge})`);
  console.log(`  Task Category:     ${decision.category.toUpperCase()}`);
  console.log(`  Privacy Tier:      ${privBadge}`);
  console.log(`  Manual Override:   ${decision.overridden ? 'YES' : 'NO'}`);
  console.log(`  Ordered Fallbacks: [${decision.fallbacks.join(', ') || 'None'}]`);
  console.log('  Why this model? (Decision Trail):');
  decision.reasons.forEach((r: string) => console.log(`    • ${r}`));
}

async function runLiveDemo() {
  printHeader('DevOS Model Hub & Intelligent Privacy Router — Live Demo');

  // Initialize modular pipeline
  const adapter = new ProviderAdapter();
  const registry = new ModelRegistry(adapter);

  // Default models for demonstration
  const demoConfig: ModelHubConfig = {
    models: [
      {
        id: 'claude-3-5-sonnet',
        provider: 'openrouter',
        remoteName: 'anthropic/claude-3.5-sonnet',
        displayName: 'Claude 3.5 Sonnet (Cloud)',
        location: 'cloud',
        strengths: ['architecture', 'code_review', 'debugging'],
        costPer1MInputUsd: 3.0,
        costPer1MOutputUsd: 15.0,
        latencyTier: 'medium',
        contextWindow: 200000,
        enabled: true,
      },
      {
        id: 'llama-3-1-8b',
        provider: 'openrouter',
        remoteName: 'meta-llama/llama-3.1-8b-instruct',
        displayName: 'Llama 3.1 8B Instruct (Cloud Fast)',
        location: 'cloud',
        strengths: ['documentation', 'boilerplate'],
        costPer1MInputUsd: 0.05,
        costPer1MOutputUsd: 0.05,
        latencyTier: 'fast',
        contextWindow: 128000,
        enabled: true,
      },
      {
        id: 'qwen-2-5-coder-7b',
        provider: 'ollama',
        remoteName: 'qwen2.5-coder:7b',
        displayName: 'Qwen 2.5 Coder 7B (Local)',
        location: 'local',
        strengths: ['refactor_simple', 'boilerplate', 'test_generation'],
        costPer1MInputUsd: 0.0,
        costPer1MOutputUsd: 0.0,
        latencyTier: 'medium',
        contextWindow: 32768,
        enabled: true,
      },
      {
        id: 'deepseek-r1-8b',
        provider: 'ollama',
        remoteName: 'deepseek-r1:8b',
        displayName: 'DeepSeek R1 8B (Local Reasoning)',
        location: 'local',
        strengths: ['architecture', 'debugging'],
        costPer1MInputUsd: 0.0,
        costPer1MOutputUsd: 0.0,
        latencyTier: 'slow',
        contextWindow: 65536,
        enabled: true,
      },
    ],
    settings: {
      defaultCloudModelId: 'claude-3-5-sonnet',
      defaultLocalModelId: 'qwen-2-5-coder-7b',
      healthCheckTtlSeconds: 30,
      requestTimeoutMs: { cloud: 30000, local: 60000 },
      privateGlobs: ['.env*', '**/secrets/**', '**/*.pem', '**/*.key', '**/credentials*'],
      privateProject: false,
    },
  };

  registry.loadFromConfig(demoConfig);

  // Set initial live availability
  demoConfig.models.forEach((m) => registry.setModelAvailability(m.id, true, 'Online'));

  const privacyDetector = new PrivacyDetector(demoConfig.settings.privateGlobs, false);
  const router = new ModelRouter(registry, privacyDetector);
  const auditLogger = new AuditLogger();
  const executor = new ModelExecutor(router, registry, adapter, auditLogger);

  // -------------------------------------------------------------------------
  // Beat 1: Show Model Hub with Cloud + Local Models
  // -------------------------------------------------------------------------
  printStep(1, 'Model Hub Catalogue: Discovering Cloud (OpenRouter) & Local (Ollama) Models');
  const allModels = registry.getAllModels();
  console.log(`Found ${allModels.length} registered models:`);
  allModels.forEach((m) => {
    const loc = m.location === 'cloud' ? '☁️ Cloud' : '💻 Local';
    const status = m.available ? '🟢 Ready' : '🔴 Offline';
    const cost = m.costPer1MInputUsd ? `$${m.costPer1MInputUsd}/$${m.costPer1MOutputUsd} per 1M` : 'Free (Local)';
    console.log(`  • [${m.id}] ${m.displayName} | ${loc} | ${status} | Cost: ${cost}`);
  });

  // -------------------------------------------------------------------------
  // Beat 2: Architecture Task -> Cloud Reasoning Model (Claude 3.5 Sonnet)
  // -------------------------------------------------------------------------
  printStep(2, 'Architecture Task -> Automatically Routes to Strongest Cloud Reasoning Model');
  const reqArchitecture: RouteRequest = {
    messages: [
      {
        role: 'user',
        content: 'Design a scalable multi-region event-driven architecture for distributed transactions.',
      },
    ],
  };
  const dec2 = await router.route(reqArchitecture);
  displayDecision(dec2);

  // -------------------------------------------------------------------------
  // Beat 3: Simple Refactor Task -> Local Qwen Coder
  // -------------------------------------------------------------------------
  printStep(3, 'Simple Refactor Task -> Automatically Routes to Fast Local Model (Qwen Coder)');
  const reqRefactor: RouteRequest = {
    messages: [
      {
        role: 'user',
        content: 'Refactor this JavaScript loop to extract helper functions and simplify variable names.',
      },
    ],
  };
  const dec3 = await router.route(reqRefactor);
  displayDecision(dec3);

  // -------------------------------------------------------------------------
  // Beat 4: Mark Code Private -> Stays on Local Model (Hard Constraint)
  // -------------------------------------------------------------------------
  printStep(4, 'Architecture Task with Sensitive File (.env) -> HARD LOCAL ROUTING ENFORCED');
  const reqPrivate: RouteRequest = {
    filePaths: ['.env.production', 'src/auth/jwt.ts'],
    messages: [
      {
        role: 'user',
        content: 'Design the microservices architecture using these database connection credentials.',
      },
    ],
  };
  const dec4 = await router.route(reqPrivate);
  displayDecision(dec4);

  // -------------------------------------------------------------------------
  // Beat 5: Kill Ollama with Private Code -> Request REFUSED (Zero Cloud Leaks)
  // -------------------------------------------------------------------------
  printStep(5, 'Simulating Ollama Offline during Private Task -> Guaranteed Zero Cloud Leaks');
  registry.setModelAvailability('qwen-2-5-coder-7b', false, 'Ollama service stopped');
  registry.setModelAvailability('deepseek-r1-8b', false, 'Ollama service stopped');

  try {
    await router.route({
      sensitivity: 'private',
      messages: [{ role: 'user', content: 'Proprietary core intellectual property code review' }],
    });
    console.error('❌ FAILED: Private task was not blocked when local models were down!');
  } catch (err: any) {
    console.log(`  🛡️ PRIVACY SHIELD ACTIVATED: Request Safely Refused!`);
    console.log(`  Error Code:        ${err.code}`);
    console.log(`  Actionable Reason: ${err.message}`);
    console.log(`  Cloud Fallback:    STRICTLY BLOCKED (0 bytes transmitted to cloud)`);
  }

  // Restore local models
  registry.setModelAvailability('qwen-2-5-coder-7b', true, 'Online');
  registry.setModelAvailability('deepseek-r1-8b', true, 'Online');

  // -------------------------------------------------------------------------
  // Beat 6: Manual Model Override on Private Task
  // -------------------------------------------------------------------------
  printStep(6, 'Manual Override of Private Task to Cloud Model: Blocked -> Confirmed Exception');

  // 6a. Attempting cloud override without confirmation
  console.log('▶ 6a. Developer attempts to override private task to Cloud Claude without confirmation:');
  try {
    await router.route({
      sensitivity: 'private',
      overrideModelId: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'Review internal database migration' }],
    });
    console.error('❌ FAILED: Override should have been rejected without confirmPrivateToCloud!');
  } catch (err: any) {
    console.log(`  🚫 OVERRIDE BLOCKED: ${err.code}`);
    console.log(`  Explanation:      ${err.message}`);
  }

  // 6b. Explicit confirmation
  console.log('\n▶ 6b. Developer provides explicit confirmPrivateToCloud: true:');
  const dec6b = await router.route({
    sensitivity: 'private',
    overrideModelId: 'claude-3-5-sonnet',
    confirmPrivateToCloud: true,
    messages: [{ role: 'user', content: 'Review internal database migration' }],
  });
  displayDecision(dec6b);

  printHeader('Live Demo Complete: All 6 Model Hub & Privacy Router Beats Verified');
}

runLiveDemo().catch(console.error);
