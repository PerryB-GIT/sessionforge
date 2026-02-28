export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')
    await setupOTel()
  }
}

async function setupOTel() {
  const endpoint = process.env.CORALOGIX_ENDPOINT
  const apiKey = process.env.CORALOGIX_API_KEY
  const appName = process.env.CORALOGIX_APP_NAME ?? 'sessionforge'

  // Skip if Coralogix not configured (local dev without .env.test)
  if (!endpoint || !apiKey) return

  const { NodeSDK } = await import('@opentelemetry/sdk-node')
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http')
  const { OTLPLogExporter } = await import('@opentelemetry/exporter-logs-otlp-http')
  const { resourceFromAttributes } = await import('@opentelemetry/resources')

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'CX-Application-Name': appName,
    'CX-Subsystem-Name': 'web',
  }

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': appName,
      'deployment.environment': process.env.NODE_ENV ?? 'development',
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
      headers,
    }),
    logRecordProcessor: new (await import('@opentelemetry/sdk-logs')).BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: `${endpoint}/v1/logs`,
        headers,
      })
    ),
  })

  sdk.start()

  // Graceful shutdown on process exit
  process.on('SIGTERM', () => { sdk.shutdown().catch(console.error) })
}
