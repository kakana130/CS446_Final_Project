// plate2home-cleanup — AWS Lambda (Node.js 22.x), run once a day by an Amazon EventBridge
// Scheduler schedule. It calls the app's retention job on the EC2 web server:
//   - deletes posts/data past their retention period (Amazon RDS),
//   - deletes their plate photos (Amazon S3),
//   - re-runs matching for recent posts (new matches send SNS alerts),
//   - unsubscribes email alerts of expired lost plates (Amazon SNS, via plate2home-notify).
//
// Environment variables:
//   APP_URL      http://ec2-x-x-x-x.compute-1.amazonaws.com   (same as the app's APP_ORIGIN)
//   CRON_SECRET  the same value as CRON_SECRET in the app's .env
//
// Timeout: set the function timeout to 1 minute.
export const handler = async () => {
  const { APP_URL, CRON_SECRET } = process.env;
  if (!APP_URL || !CRON_SECRET) throw new Error('APP_URL and CRON_SECRET must be set');

  const res = await fetch(`${APP_URL.replace(/\/+$/, '')}/api/cron/retention`, {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
    signal: AbortSignal.timeout(55_000),
  });
  const body = await res.text();
  // The response holds only counts (no personal data), so it is safe to log.
  console.log(`retention: HTTP ${res.status} ${body.slice(0, 2000)}`);
  // Throwing marks the run failed: EventBridge retries it and CloudWatch counts the error.
  if (!res.ok) throw new Error(`retention job failed with HTTP ${res.status}`);
  return JSON.parse(body);
};
