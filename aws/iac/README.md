# OpenTofu files (the week 12 approach)

An alternative to the console steps 3–7, 10 and 11 of [`AWS-DEPLOY.md`](../../AWS-DEPLOY.md).
The VPC, the three security groups and the build instance are still made by hand; these files
find them by name and create the rest. They are applied one at a time, in AWS CloudShell
(us-east-1), from a working folder outside the repository:

| File                  | Creates                                                        | `tofu plan` |
| --------------------- | -------------------------------------------------------------- | ----------- |
| `00-main.tf`          | Providers; looks up the VPC, subnets, security groups, LabRole | 0 to add    |
| `01-rds.tf`           | DB subnet group, RDS PostgreSQL (`db_password` in tfvars)      | 2 to add    |
| `02-s3.tf`            | Private photo bucket                                           | 2 to add    |
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
It and the state stay in CloudShell; never commit them. `tofu destroy` removes all 18
resources; the build instance, its AMI and the VPC are removed by hand.

The daily job uses an EventBridge **rule** (UTC cron, `0 20 * * ? *` = 03:00 in Bangkok)
rather than EventBridge Scheduler, because a rule needs no IAM role. The full Thai
walkthrough is `Plate2Home-AWS-Deploy-TH-OpenTofu.md`, next to the project folder.
