# OpenTofu files (the week 12 approach)

An alternative to the console steps 3–7, 10 and 11 of [`AWS-DEPLOY.md`](../../AWS-DEPLOY.md).
The VPC, the three security groups and the build instance are still made by hand; these files
find them by name and create the rest. They are applied one at a time, in AWS CloudShell
(us-east-1), from a working folder outside the repository:

| File                  | Creates                                                        | `tofu plan` |
| --------------------- | -------------------------------------------------------------- | ----------- |
| `00-main.tf`          | Providers; looks up the VPC, subnets, security groups, LabRole | 0 to add    |
| `01-rds.tf`           | DB subnet group, RDS PostgreSQL (`db_password` in tfvars)      | 2 to add    |
| `02-s3.tf`            | Private photo bucket, made with the AWS CLI (see the file)     | 1 to add    |
| `03-sns.tf`           | Alert topic, display name Plate2Home                           | 1 to add    |
| `04-lambda-notify.tf` | `plate2home-notify`                                            | 1 to add    |
| `05-alb.tf`           | Target group, ALB, HTTP listener                               | 3 to add    |
| `06-cleanup.tf`       | App secrets, `plate2home-cleanup`, daily EventBridge rule      | 6 to add    |
| `07-env.tf`           | Nothing: `tofu output -raw env_commands` fills `.env`          | 0 to add    |
| `08-asg.tf`           | Launch template, Auto Scaling group, CPU policy (`ami_id`)     | 3 to add    |

```bash
cd ~ && git clone https://github.com/kakana130/CS446_Final_Project.git
mkdir -p ~/plate2home-iac && cd ~/plate2home-iac
cp ~/CS446_Final_Project/aws/iac/00-main.tf . && tofu init && tofu apply -auto-approve
# then, for each next file: cp …/NN-name.tf . && tofu plan && tofu apply -auto-approve
```

`terraform.tfvars` holds `db_password` (before `01-rds.tf`) and `ami_id` (before `08-asg.tf`).
It and the state stay in CloudShell; never commit them. `tofu destroy` removes all 17
resources; the build instance, its AMI and the VPC are removed by hand.

Learner Lab denies `s3:GetBucketObjectLockConfiguration`, which the provider's `aws_s3_bucket`
reads on every refresh, so `02-s3.tf` creates the bucket with the AWS CLI from a
`terraform_data` resource (and deletes it on destroy).

The daily job uses an EventBridge **rule** (UTC cron, `0 20 * * ? *` = 03:00 in Bangkok)
rather than EventBridge Scheduler, because a rule needs no IAM role. The full Thai
walkthrough is `Plate2Home-AWS-Deploy-TH-OpenTofu.md`, next to the project folder.

## Simple version (scripts in `quick/`)

The same files, run for you by three scripts, for the simple guide
(`Plate2Home-AWS-Deploy-TH-Simple.md` and its Light/Dark PDFs). After the VPC, security groups and the build instance
exist:

1. `bash ~/CS446_Final_Project/aws/iac/quick/1-create.sh` installs OpenTofu, makes a random
   RDS password, turns on auto-assign public IPv4 for both public subnets, adds any missing
   security-group rule (inbound as in the guide, outbound "All traffic"), warns if the build
   instance has no public IP or there are two, applies `00`–`07`, then prints one line to paste
   on the build instance (clone, `.env`, `setup.sh`).
2. `bash ~/CS446_Final_Project/aws/iac/quick/2-finish.sh` images the build instance, applies
   `08-asg.tf`, replaces web servers still on an older template version one at a time
   (Learner Lab denies instance refresh), waits for two healthy targets and stops the build
   instance. For a new version: `update.sh` on the build instance, delete the `ami_id` line in
   `terraform.tfvars`, run it again.
3. `bash ~/CS446_Final_Project/aws/iac/quick/3-destroy.sh` runs `tofu destroy`, terminates the
   build instance, deletes its images and snapshots, then the three security groups and the
   VPC, and lists anything left over.
4. `bash ~/CS446_Final_Project/aws/iac/quick/reset-all.sh` starts over: it deletes every
   Plate2Home resource by name, without the OpenTofu state (also leftovers of the Manual
   guide), including the VPC, then clears `~/plate2home-iac`. It asks you to type `DELETE`.

Scripts 1–3 can be run again; they only create what is missing.
