# Plate2Home on AWS — setup guide

Plate2Home helps people in Thailand get back vehicle licence plates lost in floods. Owners
report a lost plate; finders photograph plates they found; the app reads the plate and matches
the two. This version runs entirely on AWS and adds **email alerts on a match** (Lambda + SNS)
and a **daily cleanup job** (EventBridge + Lambda).

## AWS services used

| #   | Service                     | What it does here                                                          | Counts for the project?        |
| --- | --------------------------- | -------------------------------------------------------------------------- | ------------------------------ |
| 1   | **Amazon EC2**              | Runs the website (Next.js)                                                 | ✅                             |
| 2   | **Amazon RDS (PostgreSQL)** | Database: posts, matches, contacts                                         | ✅                             |
| 3   | **Amazon S3**               | Stores the plate photos (private, temporary signed links)                  | ✅                             |
| 4   | **Amazon CloudFront**       | HTTPS address for the site, in front of EC2                                | ✅                             |
| 5   | **AWS Lambda** ×2           | `plate2home-notify` sends alerts · `plate2home-cleanup` runs the daily job | ✅                             |
| 6   | **Amazon Cognito**          | Optional sign-in ("My posts" on any device)                                | ✅                             |
| 7   | **Amazon SNS**              | Emails the owner when their plate is found                                 | ⚪ not in the slide list — ask |
| 8   | **Amazon EventBridge**      | Runs the cleanup Lambda every day at 03:00                                 | ⚪ not in the slide list — ask |
| –   | IAM, VPC, CloudWatch        | Roles, network, logs                                                       | 🟣 used, but not counted       |

## How it fits together

```
 Phone browser ──HTTPS──▶ CloudFront ──HTTP :3000──▶ EC2 (Next.js app)
                                                      │  │  │  │
                     plate photos (presigned URLs) ◀──┘  │  │  └──▶ Cognito (sign-in)
                                       Amazon S3          │  └─────▶ RDS PostgreSQL
                                                          │
            new match ──▶ Lambda plate2home-notify ──▶ SNS topic ──▶ owner's email

 EventBridge (daily 03:00) ──▶ Lambda plate2home-cleanup ──▶ CloudFront ──▶ /api/cron/retention
     (deletes expired posts in RDS + their photos in S3, re-matches, unsubscribes old alerts)
```

**The alert flow:** an owner reports a lost plate and ticks _"Email me when someone finds this
plate"_ → SNS sends a _Subscription Confirmation_ email → the owner clicks it. When a finder
uploads a matching plate, the match is saved in RDS → the app invokes `plate2home-notify` →
SNS emails the owner a link to the match.

## Before you start

- AWS Academy **Learner Lab** started, region **us-east-1 (N. Virginia)**.
- In Learner Lab you can't create IAM roles. Use the existing **`LabRole`** (Lambda,
  EventBridge) and **`LabInstanceProfile`** (EC2).
- Put this project in **your own GitHub repository**, so the EC2 instance can `git clone` it.
- Write down every value marked 📝. You will put them in `.env` in step 7.

---

## 1. Security groups (VPC) 🟣

Go to **EC2 → Security Groups → Create security group** and use the default VPC.

1. Create **`plate2home-web`**, with these inbound rules:
   - Custom TCP **3000**, source **Prefix list** `com.amazonaws.global.cloudfront.origin-facing`.
     This lets only CloudFront reach the app.
   - SSH **22**, source **My IP**.
2. Create **`plate2home-db`**, with one inbound rule:
   - PostgreSQL **5432**, source: the security group `plate2home-web`.

## 2. Amazon RDS — the database

Go to **RDS → Create database**.

1. Standard create · **PostgreSQL** (version 17) · Templates: **Free tier** (or Dev/Test).
2. DB instance identifier `plate2home-db` · Master username `postgres` · set a password 📝.
   Use letters and digits only, so it is easy to put in a URL.
3. Instance `db.t3.micro` · Storage 20 GB.
4. Connectivity: default VPC · **Public access: No** · VPC security group: **`plate2home-db`**
   (remove "default").
5. Additional configuration → **Initial database name: `plate2home`** 📝.
6. Create, wait until the status is **Available**, then copy the **Endpoint** 📝.

You don't need to create any tables by hand. Step 7 runs `npm run db:migrate`, which builds
the whole schema.

## 3. Amazon S3 — plate photos

Go to **S3 → Create bucket**.

1. Name `plate2home-crops-<your-group>` 📝 (names must be globally unique).
2. Leave **Block all public access ON**. Photos are only shown through short-lived presigned
   links that the app creates.
3. Create.
4. Optional: add a lifecycle rule to delete objects after 120 days, as a safety net. The app
   already deletes photos when it deletes a post.

## 4. Amazon SNS — the alert topic

Go to **SNS → Topics → Create topic**.

1. Type **Standard** · Name `plate2home-alerts`.
2. Create, then copy the **Topic ARN** 📝.

Don't add subscriptions yourself. The notify Lambda subscribes each owner when they opt in.

## 5. AWS Lambda — `plate2home-notify`

Go to **Lambda → Create function**.

1. Author from scratch · Name **`plate2home-notify`** · Runtime **Node.js 22.x**.
2. Permissions → **Use an existing role → `LabRole`**.
3. In the code editor, replace `index.mjs` with the contents of
   [`aws/lambda/notify/index.mjs`](aws/lambda/notify/index.mjs), then click **Deploy**.
4. Under Configuration → Environment variables, add `TOPIC_ARN` = the topic ARN from step 4.
5. Under Configuration → General, set Timeout to **30 sec**.

The app calls this function asynchronously; it only talks to SNS.

## 6. Amazon EC2 — the web server

Go to **EC2 → Launch instance**.

1. Name `plate2home-web` · **Amazon Linux 2023** · instance type **t3.small** (t3.medium
   builds faster) · key pair: create or choose one.
2. Network: default VPC, **auto-assign public IP on**, security group **`plate2home-web`**.
3. Storage **20 GB** gp3.
4. Advanced details → **IAM instance profile: `LabInstanceProfile`**. This gives the app access
   to S3 and Lambda, so no access keys are needed.
5. Launch. Then go to **Elastic IPs → Allocate**, and **Associate** it with the instance.
   Learner Lab stops instances between sessions, and without an Elastic IP the address would
   change. Copy the Elastic IP's **Public DNS** (`ec2-…compute-1.amazonaws.com`) 📝.

## 7. Install the app on EC2

Connect to the instance (EC2 → Connect → EC2 Instance Connect, or SSH), then run:

```bash
sudo dnf install -y git
sudo mkdir -p /opt/plate2home && sudo chown ec2-user /opt/plate2home
git clone https://github.com/<you>/<your-repo>.git /opt/plate2home
cd /opt/plate2home
bash aws/ec2/setup.sh        # first run only creates .env, then stops
nano .env                    # fill in the values below
```

The values to fill in (the rest can stay as they are for now):

```ini
APP_ORIGIN=http://localhost:3000           # changed to the CloudFront URL in step 8
DATABASE_URL=postgresql://postgres:<password>@<rds-endpoint>:5432/plate2home
AWS_REGION=us-east-1
S3_BUCKET=<bucket name>
NOTIFY_LAMBDA_NAME=plate2home-notify
NEXT_PUBLIC_FEATURE_ALERTS=true
CRON_SECRET=<random>        # create each with: openssl rand -base64 32
IP_HASH_SECRET=<random>
```

Optional: the admin area at `/admin`. Run `npm run admin:password` and paste both lines it
prints into `.env`.

Then run the setup script again:

```bash
bash aws/ec2/setup.sh
```

It installs Node.js 24, downloads the RDS certificate, **creates the database schema on RDS**,
builds the app and starts it as the `plate2home` service on port 3000. It finishes with
"Plate2Home is running on port 3000".

## 8. Amazon CloudFront — the HTTPS address

Go to **CloudFront → Create distribution**.

1. Origin domain: the EC2 **Public DNS** from step 6 · Protocol **HTTP only** · HTTP port **3000**.
2. Viewer protocol policy **Redirect HTTP to HTTPS** · Allowed HTTP methods
   **GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE**.
3. Cache policy **CachingDisabled** · Origin request policy **AllViewerAndCloudFrontHeaders-2022-06**.
   This passes the visitor's real IP to the app for its rate limits.
4. Web Application Firewall: **Do not enable**. Create.
5. Copy the **Distribution domain name** `https://dxxxxxxxx.cloudfront.net` 📝.

On EC2, set `APP_ORIGIN=https://dxxxxxxxx.cloudfront.net` in `.env`, then run:

```bash
bash aws/ec2/update.sh
```

Open the CloudFront URL. The site should load over HTTPS.

## 9. AWS Lambda + Amazon EventBridge — daily cleanup

**Lambda → Create function**

1. Name **`plate2home-cleanup`** · **Node.js 22.x** · existing role **`LabRole`**.
2. Paste [`aws/lambda/cleanup/index.mjs`](aws/lambda/cleanup/index.mjs), then click **Deploy**.
3. Add environment variables: `APP_URL` = the CloudFront URL, and `CRON_SECRET` = the same
   value as in `.env`.
4. Set Timeout to **1 min**. Click **Test** with any event. You should see `HTTP 200` and the
   counts in the log.

**EventBridge → Scheduler → Create schedule**

1. Name `plate2home-daily-cleanup` · **Recurring** · cron `0 3 * * ? *` · time zone
   **Asia/Bangkok** · Flexible time window **Off**.
2. Target **AWS Lambda Invoke** → `plate2home-cleanup`.
3. Permissions: **Use existing role → `LabRole`** → Create.
   - If LabRole isn't accepted, use **EventBridge → Rules → Create rule → Schedule** with the
     same cron and the Lambda as the target. Rules don't need a role.

The job deletes expired posts from RDS and their photos from S3, re-runs matching for recent
posts, and unsubscribes alert emails whose lost plate is gone.

## 10. Amazon Cognito — sign-in (optional)

The site works without accounts: posts belong to the device. Sign-in lets people see "My
posts" on any device.

Go to **Cognito → Create user pool**.

1. Application type **Traditional web application** · name `plate2home`.
2. Sign-in identifiers: **Email** · Self-registration **enabled** · Required attribute: email.
3. Return URL: `https://dxxxxxxxx.cloudfront.net/api/auth/callback`. Create.
4. Open the user pool and copy these 📝:
   - **User pool ID** (`us-east-1_…`)
   - App clients → **Client ID** and **Client secret**
   - Branding → Domain → the **Cognito domain** (`https://….auth.us-east-1.amazoncognito.com`)
5. App client → **Login pages → Edit**:
   - Allowed callback URL: `https://dxxxxxxxx.cloudfront.net/api/auth/callback`
   - OAuth grant type: **Authorization code grant**
   - Scopes: **openid, email, profile**

In `.env` on EC2, add these, then run `bash aws/ec2/update.sh`:

```ini
COGNITO_USER_POOL_ID=us-east-1_xxxxxxx
COGNITO_DOMAIN=https://<prefix>.auth.us-east-1.amazoncognito.com
COGNITO_CLIENT_ID=<client id>
COGNITO_CLIENT_SECRET=<client secret>
COGNITO_IDENTITY_PROVIDER=COGNITO
AUTH_SESSION_SECRET=<random, openssl rand -base64 32>
```

If you want **"Continue with Google"** instead:

1. Create an OAuth client in Google Cloud Console with the redirect URI
   `https://<cognito-domain>/oauth2/idpresponse`.
2. In Cognito, go to **Social and external providers → Add Google**. Use scopes
   `openid email profile`, and map `email`, `email_verified` and `picture`.
3. Enable Google on the app client's login pages.
4. Set `COGNITO_IDENTITY_PROVIDER=Google`.

## 11. Demo checklist

1. Open the CloudFront URL → **"I lost a plate"** → enter a plate, add a LINE ID and your
   email → tick **"Email me when someone finds this plate"** → submit.
2. Check your inbox (and spam) for **AWS Notification – Subscription Confirmation** → click
   **Confirm subscription**.
3. On a phone, go to **"I found a plate"** → photograph a picture of the same plate → confirm
   the plate number → submit. You should see **"match found"** at once.
4. Within seconds you get an email: _Plate2Home: a plate that may be yours was found_, with a
   link to the match.
5. Show where each part lives:
   - **S3**: the photo object in the bucket
   - **RDS**: the posts and matches tables
   - **Lambda**: Monitor → CloudWatch logs (`notify: published 1`)
   - **SNS**: the confirmed subscription
   - **EventBridge**: the schedule
6. Mark the plate as returned under **My posts**. The alert subscription is removed shortly
   after; check SNS → Subscriptions.

## Troubleshooting

| Problem                     | Check                                                                                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CloudFront shows 502/504    | On EC2, run `sudo systemctl status plate2home` and `curl localhost:3000`. Check that the security group allows 3000 from the CloudFront prefix list.                       |
| Logs                        | On EC2, `sudo journalctl -u plate2home -f`. For Lambda: Monitor → View CloudWatch logs.                                                                                    |
| `db:migrate` can't connect  | Check that the RDS security group allows 5432 from `plate2home-web`, the endpoint and password in `DATABASE_URL`, and that the password is URL-encoded.                    |
| Photos don't show           | Check `S3_BUCKET` and `AWS_REGION` in `.env`, and that the instance has `LabInstanceProfile`.                                                                              |
| No alert email              | Check that the subscription is **Confirmed** in SNS, that `NOTIFY_LAMBDA_NAME` is set, and the `plate2home-notify` logs.                                                   |
| Sign-in fails               | The callback URL must be exactly `https://<cloudfront>/api/auth/callback`, `APP_ORIGIN` must be the CloudFront URL, and the scopes must include openid, email and profile. |
| After a Learner Lab restart | Start the lab, start the EC2 instance (the app starts by itself) and check RDS is Available. The Elastic IP keeps the CloudFront origin valid.                             |

## Cleaning up (after grading)

Delete the resources in this order: CloudFront distribution (disable it first) → EC2
instance + release the Elastic IP → RDS database → S3 bucket (empty it first) → Lambda ×2 →
SNS topic → EventBridge schedule → Cognito user pool → security groups.

## What changed from the original Plate2Home

| Before                  | Now (AWS)                                 | Code                                                                                            |
| ----------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Vercel hosting          | EC2 + CloudFront                          | `aws/ec2/*`, `lib/security/ip.ts`, `proxy.ts`                                                   |
| Supabase Postgres       | RDS PostgreSQL (same SQL migrations)      | `lib/db/server.ts`, `aws/db/platform-shim.sql`, `scripts/db-migrate.mjs`                        |
| Supabase Storage        | S3 + presigned URLs                       | `lib/db/storage.ts`                                                                             |
| Supabase Auth (Google)  | Cognito (OAuth + PKCE, verified ID token) | `lib/auth/session.ts`, `app/api/auth/*`                                                         |
| Vercel Cron             | EventBridge → Lambda                      | `aws/lambda/cleanup/index.mjs`                                                                  |
| No notifications (TODO) | **New:** Lambda + SNS email alerts        | `lib/notify/index.ts`, `aws/lambda/notify/index.mjs`, migration `20261109000100_aws_alerts.sql` |
