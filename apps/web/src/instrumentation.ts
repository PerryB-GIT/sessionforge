export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')
    await setupOTel()
  }
}

async function setupOTel() {
  const appName = process.env.CORALOGIX_APP_NAME ?? 'sessionforge'

  // Build exporter list — add whichever backends are configured
  const exporters = await buildExporters(appName)
  if (exporters.traces.length === 0 && exporters.logs.length === 0) return

  const { NodeSDK } = await import('@opentelemetry/sdk-node')
  const { resourceFromAttributes } = await import('@opentelemetry/resources')
  const { SimpleSpanProcessor } = await import('@opentelemetry/sdk-trace-base')
  const { BatchLogRecordProcessor } = await import('@opentelemetry/sdk-logs')

  const resource = resourceFromAttributes({
    'service.name': appName,
    'deployment.environment': process.env.NODE_ENV ?? 'development',
  })

  const sdk = new NodeSDK({
    resource,
    spanProcessors: exporters.traces.map((e) => new SimpleSpanProcessor(e)),
    logRecordProcessor: exporters.logs.length > 0
      ? new BatchLogRecordProcessor(exporters.logs[0])
      : undefined,
  })

  sdk.start()

  process.on('SIGTERM', () => { sdk.shutdown().catch(console.error) })
}

async function buildExporters(appName: string) {
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http')
  const { OTLPLogExporter } = await import('@opentelemetry/exporter-logs-otlp-http')

  const traces: InstanceType<typeof OTLPTraceExporter>[] = []
  const logs: InstanceType<typeof OTLPLogExporter>[] = []

  // ── Coralogix ──────────────────────────────────────────────────────────────
  const cxEndpoint = process.env.CORALOGIX_ENDPOINT
  const cxKey = process.env.CORALOGIX_API_KEY
  if (cxEndpoint && cxKey) {
    const cxHeaders = {
      'Authorization': `Bearer ${cxKey}`,
      'CX-Application-Name': appName,
      'CX-Subsystem-Name': 'web',
    }
    traces.push(new OTLPTraceExporter({ url: `${cxEndpoint}/v1/traces`, headers: cxHeaders }))
    logs.push(new OTLPLogExporter({ url: `${cxEndpoint}/v1/logs`, headers: cxHeaders }))
  }

  // ── Grafana Cloud ───────────────────────────────────────────────────────────
  // Uses OTLP gateway with Basic Auth: orgId:apiKey
  const grafanaEndpoint = process.env.GRAFANA_OTLP_ENDPOINT
  const grafanaKey = process.env.GRAFANA_API_KEY
  const grafanaOrgId = process.env.GRAFANA_ORG_ID
  if (grafanaEndpoint && grafanaKey && grafanaOrgId) {
    const credentials = Buffer.from(`${grafanaOrgId}:${grafanaKey}`).toString('base64')
    const grafanaHeaders = { 'Authorization': `Basic ${credentials}` }
    traces.push(new OTLPTraceExporter({ url: `${grafanaEndpoint}/v1/traces`, headers: grafanaHeaders }))
    logs.push(new OTLPLogExporter({ url: `${grafanaEndpoint}/v1/logs`, headers: grafanaHeaders }))
  }

  return { traces, logs }
}
