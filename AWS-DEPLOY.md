# Plate2Home on AWS — setup guide

Plate2Home helps people in Thailand get back vehicle licence plates lost in floods. Owners
report a lost plate; finders photograph plates they found; the app reads the plate and matches
the two. This version runs on AWS using the services taught in the course, and adds **email
alerts on a match** (Lambda + SNS) and a **daily cleanup job** (EventBridge + Lambda).

The site is served over **plain http** straight from EC2 (nginx in front of the app). There
is no CloudFront (Learner Lab can't create distributions) and therefore no sign-in: Cognito
only works on https sites. Posts belong to the device that made them.

## AWS services used

| #   | Service                     | What it does here                                                          | Counts for the project?        |
| --- | --------------------------- | -------------------------------------------------------------------------- | ------------------------------ |
| 1   | **Amazon EC2**              | Runs the website (Next.js behind nginx, port 80)                           | ✅                             |
| 2   | **Amazon RDS (PostgreSQL)** | Database: posts, matches, contacts                                         | ✅                             |
| 3   | **Amazon S3**               | Stores the plate photos (private, temporary signed links)                  | ✅                             |
| 4   | **AWS Lambda** ×2           | `plate2home-notify` sends alerts · `plate2home-cleanup` runs the daily job | ✅                             |
| 5   | **Amazon SNS**              | Emails the owner when their plate is found (taught in labs 11–12)          | ⚪ not in the slide list — ask |
| 6   | **Amazon EventBridge**      | Runs the cleanup Lambda every day at 03:00 (taught in lab 12)              | ⚪ not in the slide list — ask |
| –   | IAM, VPC, CloudWatch        | Roles, network, logs                                                       | 🟣 used, but not counted       |

## How it fits together

```
 Browser ──http :80──▶ EC2: nginx ──▶ Next.js app (:3000)
                                       │   │
              plate photos (presigned) │   └──▶ RDS PostgreSQL
                          Amazon S3 ◀──┘
          new match ──▶ Lambda plate2home-notify ──▶ SNS topic ──▶ owner's email

 EventBridge (daily 03:00) ──▶ Lambda plate2home-cleanup ──http──▶ /api/cron/retention
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
   - **HTTP 80**, source **Anywhere-IPv4** (`0.0.0.0/0`). This is the website.
   - **SSH 22**, source **My IP**.
   - Don't open port 3000: nginx forwards to the app inside the instance.
2. Create **`plate2home-db`**, with one inbound rule:
   - **PostgreSQL 5432**, source: the security group `plate2home-web`.

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

## 4. Amazon SNS — the alert topic

Go to **SNS → Topics → Create topic**.

1. Type **Standard** · Name `plate2home-alerts`.
2. Create, then copy the **Topic ARN** 📝.

Don't add subscriptions yourself. The notify Lambda subscribes each owner when they opt in.

## 5. AWS Lambda — `plate2home-notify`

Go to **Lambda → Create function**.

1. Author from scratch · Name **`plate2home-notify`** · Runtime **Node.js 22.x**.
2. Execution role → **Use an existing role → `LabRole`**. In the newer console this is under
   **Additional settings → Execution role**.
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
   Learner Lab stops instances between sessions, and without an Elastic IP the address (and so
   the site's URL) would change. Copy the instance's **Public IPv4 DNS**
   (`ec2-…compute-1.amazonaws.com`) 📝. That is the site's address.

## 7. Install the app on EC2

Connect to the instance (EC2 → Connect → EC2 Instance Connect, or SSH), then run:

```bash
sudo dnf install -y git
sudo mkdir -p /opt/plate2home && sudo chown ec2-user /opt/plate2home
git clone https://github.com/<you>/<your-repo>.git /opt/plate2home
cd /opt/plate2home
bash aws/ec2/setup.sh        # first run only creates .env, then stops
```

Fill in `.env` (`nano .env`; the rest can stay as it is):

```ini
APP_ORIGIN=http://<EC2 Public IPv4 DNS>    # e.g. http://ec2-34-201-92-198.compute-1.amazonaws.com
DATABASE_URL=postgresql://postgres:<password>@<rds-endpoint>:5432/plate2home
AWS_REGION=us-east-1
S3_BUCKET=<bucket name>
NOTIFY_LAMBDA_NAME=plate2home-notify
NEXT_PUBLIC_FEATURE_ALERTS=true
NEXT_PUBLIC_FEATURE_ACCOUNTS=false
```

Create the two secrets without copy-pasting (after leaving nano with Ctrl+O, Enter, Ctrl+X):

```bash
sed -i "s/^CRON_SECRET=$/CRON_SECRET=$(openssl rand -hex 32)/" .env
sed -i "s/^IP_HASH_SECRET=$/IP_HASH_SECRET=$(openssl rand -hex 32)/" .env
grep -E "^(CRON_SECRET|IP_HASH_SECRET)=" .env      # write down CRON_SECRET for step 8
```

Then run the setup script again:

```bash
bash aws/ec2/setup.sh
```

It installs Node.js 24 and nginx, downloads the RDS certificate, **creates the database schema
on RDS**, builds the app, runs it as the `plate2home` service and puts nginx in front of it on
port 80. It finishes with `Plate2Home is running: http://ec2-….compute-1.amazonaws.com/`.
Open that address in a browser.

Optional: the admin area at `/admin`. Run `npm run admin:password`, paste both lines it prints
into `.env`, then `bash aws/ec2/update.sh`.

> **Followed the older CloudFront version of this guide?** Pull this version
> (`git pull`), change `APP_ORIGIN` to `http://<EC2 Public IPv4 DNS>`, run
> `bash aws/ec2/setup.sh` again (it adds nginx), and in `plate2home-web` replace the port 3000
> rule with **HTTP 80 from Anywhere-IPv4**.

## 8. AWS Lambda + Amazon EventBridge — daily cleanup

**Lambda → Create function**

1. Name **`plate2home-cleanup`** · **Node.js 22.x** · existing role **`LabRole`**.
2. Paste [`aws/lambda/cleanup/index.mjs`](aws/lambda/cleanup/index.mjs), then click **Deploy**.
3. Add environment variables: `APP_URL` = `http://<EC2 Public IPv4 DNS>` (same as
   `APP_ORIGIN`), and `CRON_SECRET` = the same value as in `.env`.
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

## 9. Demo checklist

1. Open `http://<EC2 Public IPv4 DNS>/` → **"I lost a plate"** → enter a plate, add a LINE ID
   and your email → tick **"Email me when someone finds this plate"** → submit.
2. Check your inbox (and spam) for **AWS Notification – Subscription Confirmation** → click
   **Confirm subscription**.
3. On a phone, go to **"I found a plate"** → photograph a picture of the same plate → confirm
   the plate number → submit. You should see the match at once.
4. Within seconds you get an email: _Plate2Home: a plate that may be yours was found_, with a
   link to the match.
5. Show where each part lives:
   - **EC2**: the running instance, and the site in the browser
   - **S3**: the photo object in the bucket
   - **RDS**: the database instance (Available)
   - **Lambda**: Monitor → CloudWatch logs (`notify: published 1`)
   - **SNS**: the confirmed subscription
   - **EventBridge**: the schedule
6. Mark the plate as returned under **My posts**. The alert subscription is removed shortly
   after; check SNS → Subscriptions.

## Troubleshooting

| Problem                          | Check                                                                                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Site doesn't open                | Use `http://` (not https). Check `plate2home-web` allows HTTP 80 from Anywhere. On EC2: `sudo systemctl status nginx plate2home` and `curl -I localhost`. |
| 502 Bad Gateway                  | nginx is up but the app isn't: `sudo journalctl -u plate2home -n 50`.                                                                                     |
| Forms say "bad origin"           | `APP_ORIGIN` must be exactly the address in the browser bar, with `http://` and no trailing slash. Then `bash aws/ec2/update.sh`.                         |
| `db:migrate` times out           | The RDS instance must use security group `plate2home-db`, which allows 5432 from `plate2home-web` (RDS → Modify → Connectivity).                          |
| Photos don't show / upload fails | Check `S3_BUCKET` and `AWS_REGION` in `.env`, and that the instance has `LabInstanceProfile`.                                                             |
| No alert email                   | Check the subscription is **Confirmed** in SNS, `NOTIFY_LAMBDA_NAME` is set, and the `plate2home-notify` logs.                                            |
| No "email me" checkbox           | `NEXT_PUBLIC_FEATURE_ALERTS=true` in `.env`, then `bash aws/ec2/update.sh` (NEXT_PUBLIC_ values are built into the pages).                                |
| After a Learner Lab restart      | Start the lab, start the EC2 instance (nginx and the app start by themselves) and check RDS is Available. The Elastic IP keeps the address the same.      |

## Cleaning up (after grading)

Delete the resources in this order: EC2 instance + release the Elastic IP → RDS database →
S3 bucket (empty it first) → Lambda ×2 → SNS topic → EventBridge schedule → security groups.

## What changed from the original Plate2Home

| Before                  | Now (AWS)                                                       | Code                                                                                            |
| ----------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Vercel hosting          | EC2 + nginx (plain http)                                        | `aws/ec2/*`, `lib/security/ip.ts`                                                               |
| Supabase Postgres       | RDS PostgreSQL (same SQL migrations)                            | `lib/db/server.ts`, `aws/db/platform-shim.sql`, `scripts/db-migrate.mjs`                        |
| Supabase Storage        | S3 + presigned URLs                                             | `lib/db/storage.ts`                                                                             |
| Supabase Auth (Google)  | Off on http (Cognito code kept, `NEXT_PUBLIC_FEATURE_ACCOUNTS`) | `lib/auth/session.ts`, `lib/client/session.ts`                                                  |
| Vercel Cron             | EventBridge → Lambda                                            | `aws/lambda/cleanup/index.mjs`                                                                  |
| No notifications (TODO) | **New:** Lambda + SNS email alerts                              | `lib/notify/index.ts`, `aws/lambda/notify/index.mjs`, migration `20261109000100_aws_alerts.sql` |
