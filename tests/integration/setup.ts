// Load .env.local when present, so integration tests can run against a hosted dev project.
// In CI the variables come from the workflow environment instead.
try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local: rely on the existing environment.
}
