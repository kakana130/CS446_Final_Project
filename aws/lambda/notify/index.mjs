// plate2home-notify — AWS Lambda (Node.js 22.x). Invoked asynchronously by the web app
// (lib/notify/index.ts). Talks to Amazon SNS only; it never reads the database.
//
// Environment variables:
//   TOPIC_ARN   arn:aws:sns:<region>:<account>:plate2home-alerts
//
// Events:
//   { action: 'subscribe', email, ownerKey }
//       Email subscription filtered on the owner's key. SNS emails a confirmation link first.
//   { action: 'notify', appOrigin, alerts: [{ matchId, ownerKey, plate, locale }] }
//       One message per match; only the subscription whose filter has that key receives it.
//   { action: 'prune', keep: [ownerKey, ...] }
//       Unsubscribe confirmed subscriptions whose key is not in `keep` (retention).
//
// Emails and plates are never logged.
import {
  GetSubscriptionAttributesCommand,
  ListSubscriptionsByTopicCommand,
  PublishCommand,
  SNSClient,
  SubscribeCommand,
  UnsubscribeCommand,
} from '@aws-sdk/client-sns';

const sns = new SNSClient({});
const TOPIC_ARN = process.env.TOPIC_ARN;
const KEY = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export const handler = async (event) => {
  if (!TOPIC_ARN) throw new Error('TOPIC_ARN is not set');
  switch (event?.action) {
    case 'subscribe':
      return subscribe(event);
    case 'notify':
      return notify(event);
    case 'prune':
      return prune(event);
    default:
      throw new Error('unknown action');
  }
};

async function subscribe({ email, ownerKey }) {
  if (typeof email !== 'string' || !EMAIL.test(email) || !KEY.test(ownerKey)) {
    throw new Error('bad subscribe event');
  }
  await sns.send(
    new SubscribeCommand({
      TopicArn: TOPIC_ARN,
      Protocol: 'email',
      Endpoint: email,
      Attributes: {
        FilterPolicyScope: 'MessageAttributes',
        FilterPolicy: JSON.stringify({ owner_key: [ownerKey] }),
      },
    }),
  );
  console.log('subscribe: confirmation requested');
  return { subscribed: 1 };
}

function message({ appOrigin, matchId, plate, locale }) {
  const th = locale !== 'en';
  const link = `${appOrigin}${th ? '' : '/en'}/match/${matchId}`;
  return th
    ? [
        `มีคนพบป้ายทะเบียนที่อาจเป็นของคุณ: ${plate}`,
        '',
        'ดูรูปป้ายและติดต่อผู้ที่เก็บได้ที่:',
        link,
        '',
        'ถ้าได้ป้ายคืนแล้ว กด "ได้ป้ายคืนแล้ว" ในหน้า "โพสต์ของฉัน" แล้วอีเมลแจ้งเตือนจะหยุดเอง',
        '— Plate2Home',
      ].join('\n')
    : [
        `Someone found a plate that may be yours: ${plate}`,
        '',
        'See the photo and contact the finder:',
        link,
        '',
        'Got it back? Mark it as returned under "My posts" and these emails stop.',
        '— Plate2Home',
      ].join('\n');
}

async function notify({ appOrigin, alerts }) {
  if (typeof appOrigin !== 'string' || !/^https?:\/\/[^/\s]+$/.test(appOrigin)) {
    throw new Error('bad appOrigin');
  }
  let sent = 0;
  for (const a of Array.isArray(alerts) ? alerts.slice(0, 100) : []) {
    if (!UUID.test(a?.matchId) || !KEY.test(a?.ownerKey) || typeof a.plate !== 'string') continue;
    await sns.send(
      new PublishCommand({
        TopicArn: TOPIC_ARN,
        // SNS email subjects must be ASCII.
        Subject: 'Plate2Home: a plate that may be yours was found',
        Message: message({
          appOrigin,
          matchId: a.matchId,
          plate: a.plate.slice(0, 64),
          locale: a.locale,
        }),
        MessageAttributes: { owner_key: { DataType: 'String', StringValue: a.ownerKey } },
      }),
    );
    sent += 1;
  }
  console.log(`notify: published ${sent}`);
  return { sent };
}

async function prune({ keep }) {
  if (!Array.isArray(keep)) throw new Error('bad prune event');
  const keepSet = new Set(keep.filter((k) => KEY.test(k)));
  let removed = 0;
  let checked = 0;
  let NextToken;
  do {
    const page = await sns.send(
      new ListSubscriptionsByTopicCommand({ TopicArn: TOPIC_ARN, NextToken }),
    );
    NextToken = page.NextToken;
    for (const sub of page.Subscriptions ?? []) {
      // Unconfirmed subscriptions can't be removed; SNS deletes them after a few days.
      if (!sub.SubscriptionArn?.startsWith('arn:') || sub.Protocol !== 'email') continue;
      checked += 1;
      const { Attributes } = await sns.send(
        new GetSubscriptionAttributesCommand({ SubscriptionArn: sub.SubscriptionArn }),
      );
      let keys = [];
      try {
        keys = JSON.parse(Attributes?.FilterPolicy ?? '{}').owner_key ?? [];
      } catch {
        keys = [];
      }
      if (!keys.some((k) => keepSet.has(k))) {
        await sns.send(new UnsubscribeCommand({ SubscriptionArn: sub.SubscriptionArn }));
        removed += 1;
      }
    }
  } while (NextToken);
  console.log(`prune: checked ${checked}, removed ${removed}`);
  return { checked, removed };
}
