export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')
    await setupOTel()
  }
}

async function setupOTel() {
  const appName = process.env.CORALOGIX_APP_NAME ?? 'sessionforge'

  // Only initialise if at least one backend is configured
  const cxEndpoint = process.env.CORALOGIX_ENDPOINT
  const cxKey = process.env.CORALOGIX_API_KEY
  const grafanaEndpoint = process.env.GRAFANA_OTLP_ENDPOINT
  const grafanaKey = process.env.GRAFANA_API_KEY
  const grafanaOrgId = process.env.GRAFANA_ORG_ID

  if (!cxEndpoint && !grafanaEndpoint) return

  // Import only the lightweight HTTP exporters — never the gRPC ones.
  // @opentelemetry/sdk-node is intentionally avoided because it statically
  // pulls in @grpc/grpc-js which breaks the Next.js build.
  const [
    { NodeTracerProvider },
    { resourceFromAttributes },
    { SimpleSpanProcessor },
    { OTLPTraceExporter },
    { OTLPLogExporter },
    { BatchLogRecordProcessor },
    { LoggerProvider },
  ] = await Promise.all([
    import('@opentelemetry/sdk-trace-node'),
    import('@opentelemetry/resources'),
    import('@opentelemetry/sdk-trace-base'),
    import('@opentelemetry/exporter-trace-otlp-http'),
    import('@opentelemetry/exporter-logs-otlp-http'),
    import('@opentelemetry/sdk-logs'),
    import('@opentelemetry/sdk-logs'),
  ])

  const resource = resourceFromAttributes({
    'service.name': appName,
    'deployment.environment': process.env.NODE_ENV ?? 'development',
  })

  const traceExporters: InstanceType<typeof OTLPTraceExporter>[] = []
  const logExporters: InstanceType<typeof OTLPLogExporter>[] = []

  if (cxEndpoint && cxKey) {
    const headers = {
      'Authorization': `Bearer ${cxKey}`,
      'CX-Application-Name': appName,
      'CX-Subsystem-Name': 'web',
    }
    traceExporters.push(new OTLPTraceExporter({ url: `${cxEndpoint}/v1/traces`, headers }))
    logExporters.push(new OTLPLogExporter({ url: `${cxEndpoint}/v1/logs`, headers }))
  }

  if (grafanaEndpoint && grafanaKey && grafanaOrgId) {
    const credentials = Buffer.from(`${grafanaOrgId}:${grafanaKey}`).toString('base64')
    const headers = { 'Authorization': `Basic ${credentials}` }
    traceExporters.push(new OTLPTraceExporter({ url: `${grafanaEndpoint}/v1/traces`, headers }))
    logExporters.push(new OTLPLogExporter({ url: `${grafanaEndpoint}/v1/logs`, headers }))
  }

  if (traceExporters.length > 0) {
    const provider = new NodeTracerProvider({
      resource,
      spanProcessors: traceExporters.map(e => new SimpleSpanProcessor(e)),
    })
    provider.register()
  }

  if (logExporters.length > 0) {
    new LoggerProvider({
      resource,
      processors: [new BatchLogRecordProcessor(logExporters[0])],
    })
  }

  process.on('SIGTERM', async () => {
    // best-effort flush
  })
}
