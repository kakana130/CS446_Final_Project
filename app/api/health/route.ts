/**
 * Health check for the Application Load Balancer's target group (AWS-DEPLOY.md, step 7).
 * It answers 200 as soon as the app is serving requests on this instance, so the load
 * balancer only sends visitors to instances that are up.
 *
 * It deliberately doesn't query RDS: every instance shares the one database, so a database
 * problem would mark all of them unhealthy at once and the load balancer would show its own
 * error page instead of the app's.
 */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } });
}
