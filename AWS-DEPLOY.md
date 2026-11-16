# Plate2Home on AWS — setup guide

Plate2Home helps people in Thailand get back vehicle licence plates lost in floods. Owners
report a lost plate; finders photograph plates they found; the app reads the plate and matches
the two. This version runs on AWS using the services taught in the course, and adds **email
alerts on a match** (Lambda + SNS) and a **daily cleanup job** (EventBridge + Lambda).

The site runs on **two EC2 instances in two Availability Zones behind an Application Load
Balancer**, managed by an **Auto Scaling group** (the week 9 lab pattern). If one instance or
one AZ fails, the load balancer keeps sending visitors to the other one, and the Auto Scaling
group replaces the broken instance by itself. The database sits in private subnets of the
project's own VPC.

The site is served over **plain http** (port 80 on the load balancer). There is no CloudFront
(Learner Lab can't create distributions) and therefore no sign-in: Cognito only works on https
sites. Posts belong to the device that made them.

Code: <https://github.com/kakana130/CS446_Final_Project>

## AWS services used

| #   | Service                     | What it does here                                                                     | Counts for the project?        |
| --- | --------------------------- | ------------------------------------------------------------------------------------- | ------------------------------ |
| 1   | **Amazon EC2**              | Runs the website (Next.js behind nginx), 2 instances from one AMI                     | ✅                             |
| –   | Elastic Load Balancing      | Application Load Balancer: one fixed address, spreads visitors over healthy instances | part of EC2                    |
| –   | EC2 Auto Scaling            | Keeps 2 instances running (one per AZ), adds more under load, replaces broken ones    | part of EC2                    |
| 2   | **Amazon RDS (PostgreSQL)** | Database: posts, matches, contacts                                                    | ✅                             |
| 3   | **Amazon S3**               | Stores the plate photos (private, temporary signed links)                             | ✅                             |
| 4   | **AWS Lambda** ×2           | `plate2home-notify` sends alerts · `plate2home-cleanup` runs the daily job            | ✅                             |
| 5   | **Amazon SNS**              | Emails the owner when their plate is found (taught in labs 11–12)                     | ⚪ not in the slide list — ask |
| 6   | **Amazon EventBridge**      | Runs the cleanup Lambda every day at 03:00 (taught in lab 12)                         | ⚪ not in the slide list — ask |
| –   | IAM, VPC, CloudWatch        | Roles, the project's own network, logs and the scaling alarm                          | 🟣 used, but not counted       |

## How it fits together

```
                      VPC plate2home-vpc 10.0.0.0/16
 Browser ──http :80──▶ Application Load Balancer  (public subnets in us-east-1a and us-east-1b)
                        │  health check: GET /api/health
            ┌───────────┴────────────┐
  EC2 in public subnet 1      EC2 in public subnet 2      ◀─ Auto Scaling group (2–4 instances,
  us-east-1a 10.0.0.0/24      us-east-1b 10.0.2.0/24         launched from the AMI plate2home-ami)
  nginx :80 → Next.js :3000   nginx :80 → Next.js :3000
            └───────────┬────────────┘
                        ├──▶ RDS PostgreSQL   (private subnets 10.0.1.0/24 + 10.0.3.0/24)
                        ├──▶ Amazon S3        (plate photos, presigned links)
                        └──▶ Lambda plate2home-notify ──▶ SNS topic ──▶ owner's email

 EventBridge (daily 03:00) ──▶ Lambda plate2home-cleanup ──http──▶ ALB /api/cron/retention
     (deletes expired posts in RDS + their photos in S3, re-matches, unsubscribes old alerts)
```

The instances keep no state of their own: photos are in S3, everything else in RDS, and the
device cookies are signed with secrets from `.env`, which every instance has. So any instance
can answer any request.

**The alert flow:** an owner reports a lost plate and ticks _"Email me when someone finds this
plate"_ → SNS sends a _Subscription Confirmation_ email → the owner clicks it. When a finder
uploads a matching plate, the match is saved in RDS → the app invokes `plate2home-notify` →
SNS emails the owner a link to the match.

## Before you start

- AWS Academy **Learner Lab** started, region **us-east-1 (N. Virginia)**.
- In Learner Lab you can't create IAM roles. Use the existing **`LabRole`** (Lambda,
  EventBridge) and **`LabInstanceProfile`** (EC2).
- The EC2 build instance `git clone`s this repository.
- Write down every value marked 📝. You will put them in `.env` in step 9.

**With OpenTofu instead (the week 12 approach):** do steps 1–2 here (without the DB subnet
group), then create RDS, S3, SNS, both Lambdas, EventBridge, the load balancer and the Auto
Scaling group from [`aws/iac/`](aws/iac/README.md) in CloudShell, one file at a time. Steps 8–9
and the AMI stay manual. `tofu destroy` removes everything it made.

---

## 1. VPC — the project's own network 🟣

The same layout as the course labs (4-Understanding VPC, 5-Understanding Database): two
Availability Zones, each with a public and a private subnet. Web servers and the load balancer
go in the public subnets, the database in the private ones.

Go to **VPC → Create VPC → VPC and more**.

1. Name tag auto-generation `plate2home` · IPv4 CIDR `10.0.0.0/16` · no IPv6 · Tenancy
   Default.
2. Number of AZs **2** → Customize AZs: `us-east-1a`, `us-east-1b`.
3. Public subnets **2**, private subnets **2** → Customize subnets CIDR blocks:
   public `10.0.0.0/24` (1a) and `10.0.2.0/24` (1b), private `10.0.1.0/24` (1a) and
   `10.0.3.0/24` (1b).
4. NAT gateways **None** · VPC endpoints **None**. Nothing in the private subnets needs the
   internet (RDS doesn't), and a NAT gateway is billed by the hour.
5. Keep **Enable DNS hostnames** and **Enable DNS resolution** ticked → **Create VPC**.
6. **Subnets** → select `plate2home-subnet-public1-us-east-1a` → Actions → **Edit subnet
   settings** → tick **Enable auto-assign public IPv4 address** → Save. Do the same for
   `plate2home-subnet-public2-us-east-1b`. The Auto Scaling instances need a public address to
   reach S3, SNS and Lambda.

Then the **DB subnet group** (where RDS may place the database): **RDS → Subnet groups →
Create DB subnet group** · Name `plate2home-db-subnets` · VPC `plate2home-vpc` · AZs
`us-east-1a` and `us-east-1b` · Subnets: the two **private** ones (`10.0.1.0/24`,
`10.0.3.0/24`) → Create.

## 2. Security groups 🟣

Go to **EC2 → Security Groups → Create security group**, and choose VPC **`plate2home-vpc`**
each time. Each layer only accepts traffic from the layer in front of it.

| Name             | Inbound rules                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| `plate2home-alb` | **HTTP 80** from **Anywhere-IPv4** (`0.0.0.0/0`). This is the website.                                              |
| `plate2home-web` | **HTTP 80** from the security group **`plate2home-alb`** · **SSH 22** from Anywhere-IPv4 (for EC2 Instance Connect) |
| `plate2home-db`  | **PostgreSQL 5432** from the security group **`plate2home-web`**                                                    |

Create them in this order, because each one refers to the one before. Visitors can't reach the
instances directly, only through the load balancer. Port 3000 stays closed everywhere.

## 3. Amazon RDS — the database

Go to **RDS → Create database**.

1. Standard create · **PostgreSQL** (version 17) · Templates: **Free tier**.
2. DB instance identifier `plate2home-db` · Master username `postgres` · set a password 📝.
   Use letters and digits only, so it is easy to put in a URL.
3. Instance `db.t3.micro` · Storage 20 GB.
4. Connectivity: **Don't connect to an EC2 compute resource** · VPC **`plate2home-vpc`** ·
   DB subnet group **`plate2home-db-subnets`** · **Public access: No** · VPC security group:
   **`plate2home-db`** (remove "default").
5. Additional configuration → **Initial database name: `plate2home`**. Don't skip this: without
   it the app reports `database "plate2home" does not exist` (see Troubleshooting).
6. Create, wait until the status is **Available**, then copy the **Endpoint** 📝.

You don't need to create any tables by hand. Step 9 runs `npm run db:migrate`, which builds
the whole schema.

## 4. Amazon S3 — plate photos

Go to **S3 → Create bucket**.

1. Name `plate2home-crops-<your-group>` 📝 (names must be globally unique).
2. Leave **Block all public access ON**. Photos are only shown through short-lived presigned
   links that the app creates.
3. Create.

## 5. Amazon SNS — the alert topic

Go to **SNS → Topics → Create topic**.

1. Type **Standard** · Name `plate2home-alerts` · Display name **`Plate2Home`**.
2. Create, then copy the **Topic ARN** 📝.

Don't add subscriptions yourself. The notify Lambda subscribes each owner when they opt in.

The display name is the sender name on every email from this topic, both the confirmation and
the match alerts, so they arrive from **Plate2Home**. Without it they come from "AWS
Notifications". The confirmation email's subject and text are fixed by SNS (English); the site
tells owners to expect it, next to the checkbox and after they submit. It is SNS's double
opt-in: no one can sign someone else's address up for alerts. The match alert itself is
written by the notify Lambda: an English email with both plates, exact or possible match, when
and where the plate was found, the match link, safety tips and how to stop the alerts.
For a topic that already exists: **SNS → Topics → `plate2home-alerts` → Edit → Display name**.

## 6. AWS Lambda — `plate2home-notify`

Go to **Lambda → Create function**.

1. Author from scratch · Name **`plate2home-notify`** · Runtime **Node.js 22.x**.
2. Execution role → **Use an existing role → `LabRole`**. In the newer console this is under
   **Additional settings → Execution role**.
3. In the code editor, replace `index.mjs` with the contents of
   [`aws/lambda/notify/index.mjs`](aws/lambda/notify/index.mjs), then click **Deploy**.
4. Under Configuration → Environment variables, add `TOPIC_ARN` = the topic ARN from step 5.
5. Under Configuration → General, set Timeout to **30 sec**.

The app calls this function asynchronously; it only talks to SNS.

## 7. Elastic Load Balancing — target group and load balancer

The load balancer comes before the servers because its address is the site's address, which
goes into `.env`.

**Target group:** **EC2 → Target Groups → Create target group**

1. Target type **Instances** · Name `plate2home-tg` · Protocol **HTTP** · Port **80** ·
   VPC **`plate2home-vpc`** · Protocol version HTTP1.
2. Health checks: protocol HTTP · path **`/api/health`**. That endpoint answers `200` as soon
   as the app runs on the instance.
3. Next → don't register any targets yet → **Create target group**.

**Load balancer:** **EC2 → Load Balancers → Create load balancer → Application Load Balancer**

1. Name `plate2home-alb` · Scheme **Internet-facing** · IP address type **IPv4**.
2. VPC **`plate2home-vpc`** · Availability Zones: tick **us-east-1a** → `…public1-us-east-1a`
   and **us-east-1b** → `…public2-us-east-1b`. (An ALB must span at least two AZs; this is
   what the second public subnet is for.)
3. Security groups: **`plate2home-alb`** only (remove "default").
4. Listener **HTTP : 80** → Forward to **`plate2home-tg`** → **Create load balancer**.
5. Copy its **DNS name** 📝 (`plate2home-alb-….us-east-1.elb.amazonaws.com`). **That is the
   site's address.** It never changes, so no Elastic IP is needed.

## 8. Amazon EC2 — the build instance

This instance is where the app is installed and built once. It becomes the image (AMI) that
the Auto Scaling group copies, and later it is where new versions are built.

Go to **EC2 → Launch instance**.

1. Name `plate2home-build` · **Amazon Linux 2023** · instance type **t3.small** (t3.medium
   builds faster) · key pair **vockey** (or your own).
2. Network settings → Edit: VPC **`plate2home-vpc`** · Subnet
   **`plate2home-subnet-public1-us-east-1a`** · **Auto-assign public IP: Enable** · security
   group **`plate2home-web`**.
3. Storage **20 GB** gp3.
4. Advanced details → **IAM instance profile: `LabInstanceProfile`**. This gives the app access
   to S3 and Lambda, so no access keys are needed.
5. Launch.

## 9. Install the app on the build instance

Connect to the instance (EC2 → Connect → EC2 Instance Connect), then run:

```bash
sudo dnf install -y git
sudo mkdir -p /opt/plate2home && sudo chown ec2-user /opt/plate2home
git clone https://github.com/kakana130/CS446_Final_Project.git /opt/plate2home
cd /opt/plate2home
bash aws/ec2/setup.sh        # first run only creates .env, then stops
```

Fill in `.env` (`nano .env`; the rest can stay as it is):

```ini
APP_ORIGIN=http://<ALB DNS name>    # e.g. http://plate2home-alb-1234567890.us-east-1.elb.amazonaws.com
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
grep -E "^(CRON_SECRET|IP_HASH_SECRET)=" .env      # write down CRON_SECRET for step 11
```

Then run the setup script again:

```bash
bash aws/ec2/setup.sh
```

It installs Node.js 24 and nginx, downloads the RDS certificate, **creates the database schema
on RDS**, builds the app, runs it as the `plate2home` service and puts nginx in front of it on
port 80. It finishes with `Plate2Home is running on this instance`.

**Try it through the load balancer:** **Target Groups → `plate2home-tg` → Targets → Register
targets** → tick `plate2home-build` → **Include as pending below** → **Register pending
targets**. When its status turns **healthy** (about a minute), open `http://<ALB DNS name>/`.

Optional: the admin area at `/admin`. Run `npm run admin:password`, paste both lines it prints
into `.env`, then `bash aws/ec2/update.sh`.

## 10. AMI, launch template and Auto Scaling group

**Image:** **Instances** → select `plate2home-build` → Actions → **Image and templates →
Create image** · Name `plate2home-ami-v1` → Create. The instance restarts once. Wait until
**AMIs** shows it as **Available** (5–10 minutes). The image holds the built app, `.env`,
nginx and the systemd service, so a new instance from it serves the site as soon as it boots.

**Launch template:** **Launch Templates → Create launch template**

1. Name `plate2home-lt` · tick **Provide guidance to help me set up a template that I can use
   with EC2 Auto Scaling**.
2. AMI: **My AMIs → Owned by me → `plate2home-ami-v1`**.
3. Instance type **t3.small** · key pair **vockey**.
4. Network settings: Subnet **Don't include in launch template** · security group
   **`plate2home-web`**.
5. Advanced details → **IAM instance profile: `LabInstanceProfile`** (without it, uploads to
   S3 fail on these instances) → **Create launch template**.

**Auto Scaling group:** **Auto Scaling Groups → Create Auto Scaling group**

1. Name `plate2home-asg` · launch template `plate2home-lt`, version **Latest**.
2. VPC **`plate2home-vpc`** · subnets **`…public1-us-east-1a`** and **`…public2-us-east-1b`**
   · AZ distribution **Balanced best effort**.
3. Load balancing: **Attach to an existing load balancer** → choose from target groups →
   **`plate2home-tg`** · tick **Turn on Elastic Load Balancing health checks**.
4. Group size: **Desired 2 · Min 2 · Max 4**. Scaling: **Target tracking scaling policy** ·
   metric **Average CPU utilization** · target **60**.
5. Create. Within a few minutes **Instance management** shows two instances, one per AZ, and
   the target group shows them **healthy**.

**Retire the build instance from serving:** in `plate2home-tg` → Targets, select
`plate2home-build` → **Deregister**, then **Stop** the instance. Keep it (stopped) for building
the next version.

## 11. AWS Lambda + Amazon EventBridge — daily cleanup

**Lambda → Create function**

1. Name **`plate2home-cleanup`** · **Node.js 22.x** · existing role **`LabRole`**.
2. Paste [`aws/lambda/cleanup/index.mjs`](aws/lambda/cleanup/index.mjs), then click **Deploy**.
3. Add environment variables: `APP_URL` = `http://<ALB DNS name>` (same as `APP_ORIGIN`), and
   `CRON_SECRET` = the same value as in `.env`.
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
posts, and unsubscribes alert emails whose lost plate is gone. It goes through the load
balancer, so whichever instance is healthy runs it.

## 12. Demo checklist

1. Open `http://<ALB DNS name>/` → **"I lost a plate"** → enter a plate, add a LINE ID and
   your email → tick **"Email me when someone finds this plate"** → submit.
2. Check your inbox (and spam) for **AWS Notification – Subscription Confirmation** → click
   **Confirm subscription**.
3. On a phone, go to **"I found a plate"** → photograph a picture of the same plate → confirm
   the plate number → submit. You should see the match at once.
4. Within seconds you get an email from **Plate2Home**: _Plate2Home: someone found a plate
   matching yours_ (_…similar to yours_ on a near match), with a link to the match.
5. **High availability:** stop one of the two Auto Scaling instances. The site keeps working
   (the load balancer only uses the healthy one), and within a few minutes the Auto Scaling
   group launches a replacement (Activity tab).
6. Show where each part lives:
   - **VPC**: Resource map (public/private subnets in two AZs)
   - **EC2**: Load balancer resource map, target group with 2 healthy targets, Auto Scaling
     group activity
   - **S3**: the photo object in the bucket
   - **RDS**: the database instance (Available)
   - **Lambda**: Monitor → CloudWatch logs (`notify: published 1`)
   - **SNS**: the confirmed subscription
   - **EventBridge**: the schedule
7. Mark the plate as returned under **My posts**. The alert subscription is removed shortly
   after; check SNS → Subscriptions.

## Deploying a new version

Build once, then roll the same build out to every instance:

1. Start `plate2home-build`, connect, and run `cd /opt/plate2home && bash aws/ec2/update.sh`
   (pulls, installs, migrates RDS, builds). Then stop it again.
2. Create an image from it: `plate2home-ami-v2`.
3. **Launch Templates → `plate2home-lt` → Actions → Modify template (Create new version)** →
   AMI `plate2home-ami-v2` → Create template version.
4. **Auto Scaling Groups → `plate2home-asg` → Instance refresh → Start instance refresh** ·
   minimum healthy percentage **50%**. The group replaces the instances one at a time, so the
   site stays up.

Never run `update.sh` on the Auto Scaling instances themselves: every build names its page
assets differently, so instances built separately would serve pages that don't fit together.
`update.sh` applies database migrations before the new version is live, so a migration must
keep working with the version that is still running.

## Troubleshooting

| Problem                                        | Check                                                                                                                                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Site doesn't open                              | Use `http://` (not https) and the **ALB DNS name**. `plate2home-alb` must allow HTTP 80 from Anywhere.                                                                                                        |
| `503 Service Temporarily Unavailable` (ALB)    | No healthy targets. Target group → Targets shows why. Check `plate2home-web` allows HTTP 80 from `plate2home-alb`, the health check path is `/api/health`, and on an instance `curl -i localhost/api/health`. |
| `502 Bad Gateway`                              | The instance answers but the app doesn't: `sudo journalctl -u plate2home -n 50`.                                                                                                                              |
| Forms say "bad origin"                         | `APP_ORIGIN` must be exactly `http://<ALB DNS name>` (no trailing slash). Fix it on the build instance, `bash aws/ec2/update.sh`, then roll out a new AMI.                                                    |
| `db:migrate` times out                         | EC2 and RDS must be in `plate2home-vpc`; RDS uses `plate2home-db`, which allows 5432 from `plate2home-web`.                                                                                                   |
| `database "plate2home" does not exist`         | The RDS initial database name was left empty. On the build instance, in `/opt/plate2home`, run the command below, then `bash aws/ec2/setup.sh` again.                                                         |
| Can't find the security group / subnet         | Choose VPC `plate2home-vpc` first; resources of other VPCs aren't listed.                                                                                                                                     |
| Photos fail only on the Auto Scaling instances | The launch template needs `LabInstanceProfile`, and the public subnets need **auto-assign public IPv4** (step 1.6).                                                                                           |
| No alert email                                 | Check the subscription is **Confirmed** in SNS, `NOTIFY_LAMBDA_NAME` is set, and the `plate2home-notify` logs.                                                                                                |
| No "email me" checkbox                         | `NEXT_PUBLIC_FEATURE_ALERTS=true` in `.env`, then `update.sh` on the build instance and roll out (NEXT_PUBLIC_ values are built into the pages).                                                              |
| After a Learner Lab restart                    | Start the lab and check RDS is Available. The Auto Scaling group brings the instances back (or replaces them) by itself; the ALB address never changes.                                                       |

Create the missing database (run on the build instance in `/opt/plate2home`):

```bash
node --env-file=.env -e "const {Client}=require('pg');const u=new URL(process.env.DATABASE_URL);u.pathname='/postgres';const c=new Client({connectionString:u.toString(),ssl:{rejectUnauthorized:false}});c.connect().then(()=>c.query('create database plate2home')).then(()=>{console.log('OK: created plate2home');return c.end()}).catch(e=>{console.error(e.message);process.exit(1)})"
```

## Cleaning up (after grading)

The load balancer is billed by the hour even while the lab is stopped. Delete in this order:

Auto Scaling group (terminates its instances) → load balancer → target group → launch template
→ AMIs (Deregister) and their snapshots (EC2 → Snapshots) → build instance (Terminate) → RDS
database (no final snapshot) → S3 bucket (empty it first) → Lambda ×2 → SNS topic →
EventBridge schedule → DB subnet group → VPC (Delete VPC also removes its subnets, route
tables, internet gateway and security groups).

## What changed from the original Plate2Home

| Before                  | Now (AWS)                                                       | Code                                                                                            |
| ----------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Vercel hosting          | ALB + Auto Scaling group of EC2 instances (nginx, plain http)   | `aws/ec2/*`, `app/api/health/route.ts`, `lib/security/ip.ts`                                    |
| Supabase Postgres       | RDS PostgreSQL in private subnets (same SQL migrations)         | `lib/db/server.ts`, `aws/db/platform-shim.sql`, `scripts/db-migrate.mjs`                        |
| Supabase Storage        | S3 + presigned URLs                                             | `lib/db/storage.ts`                                                                             |
| Supabase Auth (Google)  | Off on http (Cognito code kept, `NEXT_PUBLIC_FEATURE_ACCOUNTS`) | `lib/auth/session.ts`, `lib/client/session.ts`                                                  |
| Vercel Cron             | EventBridge → Lambda                                            | `aws/lambda/cleanup/index.mjs`                                                                  |
| No notifications (TODO) | **New:** Lambda + SNS email alerts                              | `lib/notify/index.ts`, `aws/lambda/notify/index.mjs`, migration `20261109000100_aws_alerts.sql` |
