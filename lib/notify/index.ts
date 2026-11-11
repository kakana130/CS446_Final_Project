import 'server-only';
import { createHmac } from 'node:crypto';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { alertEmails, markMatchesNotified, matchAlerts } from '@/lib/db/alerts';
import type { RecordedMatch } from '@/lib/db/matches';
import { requireEnv, serverEnv } from '@/lib/env/server';
import { logError } from '@/lib/log';

/**
 * Match alerts (AWS port): the app never talks to SNS itself. It invokes the
 * `plate2home-notify` Lambda function asynchronously (lambda/notify/index.mjs), which
 *  - subscribe:  subscribes the owner's email to the SNS topic (SNS sends a confirmation
 *                email first: double opt-in), filtered on a keyed hash of that email;
 *  - notify:     publishes one message per new match with that hash as a message attribute,
 *                so only that owner's subscription receives it;
 *  - prune:      unsubscribes every confirmed email whose hash is no longer in the keep list.
 * Emails go to Lambda only for `subscribe`; alerts and prunes carry hashes.
 */

export function alertsConfigured(): boolean {
  const env = serverEnv();
  return Boolean(env.NOTIFY_LAMBDA_NAME && env.AWS_REGION && env.IP_HASH_SECRET);
}

/** The SNS filter key for an email: HMAC so SNS attributes never hold a guessable hash. */
export function ownerKey(email: string): string {
  return createHmac('sha256', requireEnv('IP_HASH_SECRET'))
    .update(`sns-owner:${email.trim().toLowerCase()}`)
    .digest('hex');
}

let client: LambdaClient | undefined;

type NotifyEvent =
  | { action: 'subscribe'; email: string; ownerKey: string }
  | {
      action: 'notify';
      appOrigin: string;
      alerts: {
        matchId: string;
        ownerKey: string;
        plate: string;
        locale: 'th' | 'en';
      }[];
    }
  | { action: 'prune'; keep: string[] };

/** Fire-and-forget (InvocationType Event): Lambda queues and retries it on its own. */
async function invoke(event: NotifyEvent): Promise<void> {
  client ??= new LambdaClient({ region: requireEnv('AWS_REGION') });
  const res = await client.send(
    new InvokeCommand({
      FunctionName: requireEnv('NOTIFY_LAMBDA_NAME'),
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify(event)),
    }),
  );
  if (res.StatusCode !== 202) throw new Error(`lambda_invoke_${res.StatusCode}`);
}

/** Ask SNS to email the owner a confirmation link for alerts on their lost plate. */
export async function subscribeOwner(email: string): Promise<void> {
  if (!alertsConfigured()) return;
  await invoke({ action: 'subscribe', email, ownerKey: ownerKey(email) });
}

/** Tell lost-plate owners who opted in about new matches; marks those matches notified. */
export async function notifyNewMatches(matches: RecordedMatch[]): Promise<void> {
  if (matches.length === 0 || !alertsConfigured()) return;
  const alerts = await matchAlerts(matches.map((m) => m.matchId));
  if (alerts.length === 0) return;
  const appOrigin = serverEnv().APP_ORIGIN ?? '';
  await invoke({
    action: 'notify',
    appOrigin,
    alerts: alerts.map((a) => ({
      matchId: a.matchId,
      ownerKey: ownerKey(a.email),
      plate: a.plateDisplay,
      locale: a.locale,
    })),
  });
  await markMatchesNotified(alerts.map((a) => a.matchId));
}

/** Unsubscribe emails that no longer have an active lost watch with alerts on. */
export async function pruneSubscriptions(): Promise<number> {
  if (!alertsConfigured()) return 0;
  const keep = [...new Set((await alertEmails()).map(ownerKey))];
  await invoke({ action: 'prune', keep });
  return keep.length;
}

/** Same, but never fails the caller (used after an owner removes or resolves a post). */
export function pruneSubscriptionsLater(scope: string): void {
  pruneSubscriptions().catch((err) => logError(scope, err));
}
