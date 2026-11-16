// plate2home-notify — AWS Lambda (Node.js 22.x). Invoked asynchronously by the web app
// (lib/notify/index.ts). Talks to Amazon SNS only; it never reads the database.
//
// Environment variables:
//   TOPIC_ARN   arn:aws:sns:<region>:<account>:plate2home-alerts
//
// Events:
//   { action: 'subscribe', email, ownerKey }
//       Email subscription filtered on the owner's key. SNS emails a confirmation link first.
//   { action: 'notify', appOrigin,
//     alerts: [{ matchId, ownerKey, role, plate, otherPlate, kind, foundAt, handover, locale }] }
//       One English email per recipient (role 'owner' or 'finder'); only the subscription whose
//       filter has that key receives it. `locale` picks the language of links and button names.
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

// Button and page names as the owner sees them on the site, in the language they used.
const UI = {
  th: {
    reveal: "ดูช่องทางติดต่อคนที่เก็บป้ายได้ (See the finder's contact details)",
    myPosts: 'โพสต์ของฉัน (My posts)',
    resolve: 'ได้ป้ายคืนแล้ว (I got my plate back)',
    optIn: 'ส่งอีเมลแจ้งฉันเมื่อมีคนเจอป้ายนี้ (Email me when someone finds this plate)',
    ownerContact: "ดูช่องทางติดต่อเจ้าของป้าย (See the owner's contact details)",
    returned: 'คืนป้ายให้เจ้าของแล้ว (Returned to the owner)',
    optInFound:
      'ส่งอีเมลแจ้งฉันเมื่อเจ้าของป้ายมาแจ้งหาย (Email me when the owner reports this plate lost)',
  },
  en: {
    reveal: "See the finder's contact details",
    myPosts: 'My posts',
    resolve: 'I got my plate back',
    optIn: 'Email me when someone finds this plate',
    ownerContact: "See the owner's contact details",
    returned: 'Returned to the owner',
    optInFound: 'Email me when the owner reports this plate lost',
  },
};

const WHERE = {
  with_finder: 'With the person who found it',
  police_station:
    "Handed in at a police station (which one is shown with the finder's contact details)",
};

function foundWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)} (Bangkok time)`;
}

// SNS email subjects must be ASCII, under 100 characters.
function subject(role, kind) {
  if (role === 'finder') {
    return kind === 'exact'
      ? 'Plate2Home: the owner of a plate you found has reported it lost'
      : 'Plate2Home: someone reported a lost plate similar to one you found';
  }
  return kind === 'exact'
    ? 'Plate2Home: someone found a plate matching yours'
    : 'Plate2Home: someone found a plate similar to yours';
}

// Plain text: SNS sends email bodies as plain text and adds its own unsubscribe footer.
// For the lost plate's owner: `plate` is their lost plate, `otherPlate` the found one.
function ownerMessage({ appOrigin, matchId, plate, otherPlate, kind, foundAt, handover, locale }) {
  const ui = UI[locale === 'en' ? 'en' : 'th'];
  const base = `${appOrigin}${locale === 'en' ? '/en' : ''}`;
  const exact = kind === 'exact';
  const when = foundWhen(foundAt);
  return [
    'Hello,',
    '',
    exact
      ? 'Good news: someone has found a licence plate that matches the one you reported lost on Plate2Home.'
      : 'Someone has found a licence plate that is similar to the one you reported lost on Plate2Home. It may be yours.',
    '',
    `Your lost plate: ${plate}`,
    `Plate they found: ${otherPlate}`,
    exact
      ? 'Match: Exact (same number)'
      : 'Match: Possible (the numbers are close but not identical, so check the photo carefully)',
    ...(when ? [`Found: ${when}`] : []),
    ...(WHERE[handover] ? [`Where the plate is now: ${WHERE[handover]}`] : []),
    '',
    'SEE THE PHOTO AND CONTACT THE FINDER',
    `${base}/match/${matchId}`,
    `Check the photo first. If it is your plate, tap "${ui.reveal}" on that page to get the finder's LINE ID, phone or email and arrange to get it back.`,
    '',
    'STAY SAFE',
    '- Never transfer money before you have the plate back.',
    '- Ask the finder for a photo of the plate next to a note with your name, so you know they really have it.',
    '- Bring your vehicle registration book and ID card when you collect it, to show the plate is yours.',
    '',
    'GOT YOUR PLATE BACK?',
    `Open "${ui.myPosts}" on the phone or computer you used to report it, and tap "${ui.resolve}". This closes your report and stops these emails.`,
    `${base}/my-posts`,
    '',
    'WHY YOU GOT THIS EMAIL',
    `You reported this plate lost on Plate2Home and ticked "${ui.optIn}". To stop these emails without closing your report, use the unsubscribe link at the bottom of this email.`,
    '',
    'Plate2Home',
    base,
  ].join('\n');
}

// For the finder: `plate` is the plate they found, `otherPlate` the one the owner reported lost.
function finderMessage({ appOrigin, matchId, plate, otherPlate, kind, locale }) {
  const ui = UI[locale === 'en' ? 'en' : 'th'];
  const base = `${appOrigin}${locale === 'en' ? '/en' : ''}`;
  const exact = kind === 'exact';
  return [
    'Hello,',
    '',
    exact
      ? 'Good news: the owner of a licence plate you found has reported it lost on Plate2Home.'
      : 'Someone has reported a lost licence plate on Plate2Home that is similar to one you found. It may be theirs.',
    '',
    `Plate you found: ${plate}`,
    `Plate they lost: ${otherPlate}`,
    exact
      ? 'Match: Exact (same number)'
      : 'Match: Possible (the numbers are close but not identical)',
    '',
    'SEE THE MATCH AND CONTACT THE OWNER',
    `${base}/match/${matchId}`,
    `Open it on the phone or computer you used to post the plate, then tap "${ui.ownerContact}" to get the owner's LINE ID, phone or email and arrange the handover.`,
    '',
    'STAY SAFE',
    '- Only hand the plate over to someone who shows you the vehicle registration book with the same plate number, and an ID card with the same name.',
    '- If more than one person claims the plate, or you are not sure, take it to a police station instead.',
    '- Never pay or ask for money to return a plate.',
    '',
    'RETURNED IT?',
    `Open "${ui.myPosts}" on the phone or computer you used to post it, and tap "${ui.returned}". This closes your post and stops these emails.`,
    `${base}/my-posts`,
    '',
    'WHY YOU GOT THIS EMAIL',
    `You posted this plate as found on Plate2Home and ticked "${ui.optInFound}". To stop these emails without closing your post, use the unsubscribe link at the bottom of this email.`,
    '',
    'Plate2Home',
    base,
  ].join('\n');
}

const KINDS = new Set(['exact', 'near']);

async function notify({ appOrigin, alerts }) {
  if (typeof appOrigin !== 'string' || !/^https?:\/\/[^/\s]+$/.test(appOrigin)) {
    throw new Error('bad appOrigin');
  }
  let sent = 0;
  for (const a of Array.isArray(alerts) ? alerts.slice(0, 100) : []) {
    if (!UUID.test(a?.matchId) || !KEY.test(a?.ownerKey) || typeof a.plate !== 'string') continue;
    const kind = KINDS.has(a.kind) ? a.kind : 'near';
    const role = a.role === 'finder' ? 'finder' : 'owner';
    const other = typeof a.otherPlate === 'string' ? a.otherPlate : a.foundPlate;
    const fields = {
      appOrigin,
      matchId: a.matchId,
      plate: a.plate.slice(0, 64),
      otherPlate: typeof other === 'string' ? other.slice(0, 64) : a.plate.slice(0, 64),
      kind,
      foundAt: typeof a.foundAt === 'string' ? a.foundAt : '',
      handover: a.handover,
      locale: a.locale,
    };
    await sns.send(
      new PublishCommand({
        TopicArn: TOPIC_ARN,
        Subject: subject(role, kind),
        Message: role === 'finder' ? finderMessage(fields) : ownerMessage(fields),
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
