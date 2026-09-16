const [moduleUrl, databasePath] = process.argv.slice(2);
try {
  const { EventStore } = await import(moduleUrl);
  const store = new EventStore(databasePath);
  store.close();
  process.stdout.write(`${JSON.stringify({ status: 'opened' })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: 'rejected', code: error.code ?? 'UNSUPPORTED_SCHEMA', message: error.message })}\n`);
  process.exitCode = 2;
}
