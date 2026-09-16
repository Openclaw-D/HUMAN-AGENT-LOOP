import { AdvisoryService } from '../application/advisory-service.js';
import { createConfiguredProvider, defaultDeadlineForOperation, loadProviderRuntimeConfig } from '../config/provider-runtime.js';
import { ProviderTelemetryRepository } from '../persistence/provider-telemetry.js';

export function createAdvisoryRuntime({ service, env = process.env, telemetry = null, provider = null } = {}) {
  if (!service || typeof service.getWorkCase !== 'function') throw new TypeError('Advisory runtime requires RelayService read queries.');
  const config = loadProviderRuntimeConfig(env);
  const providerExecutor = provider ?? createConfiguredProvider(config);
  const telemetryRepository = telemetry ?? new ProviderTelemetryRepository(config.telemetryPath);
  const advisoryService = new AdvisoryService({
    getWorkCase: (workCaseId) => service.getWorkCase(workCaseId),
    provider: providerExecutor,
    telemetry: telemetryRepository,
    deadlinePolicy: (operation) => defaultDeadlineForOperation(operation, config),
  });
  return {
    config,
    service: advisoryService,
    close() { telemetryRepository.close?.(); },
  };
}
