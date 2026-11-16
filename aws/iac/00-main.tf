# Plate2Home on AWS with OpenTofu (the week 12 approach). Run in AWS CloudShell, us-east-1.
# The VPC and the three security groups are made by hand first (deploy guide, steps 1–2);
# these files find them by name and build everything else, one file per step.

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    # Zips the Lambda code from the cloned repository.
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
    # Makes the app's secrets (CRON_SECRET, IP_HASH_SECRET).
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
  default_tags {
    tags = { Project = "plate2home" }
  }
}

# Where the group repository is cloned in CloudShell (Lambda code comes from here).
variable "repo_dir" {
  type    = string
  default = "~/CS446_Final_Project"
}

locals {
  repo = pathexpand(var.repo_dir)
}

# --- What was made by hand --------------------------------------------------------------

data "aws_caller_identity" "me" {}

data "aws_vpc" "main" {
  tags = { Name = "plate2home-vpc" }
}

data "aws_subnet" "public1" {
  vpc_id = data.aws_vpc.main.id
  tags   = { Name = "plate2home-subnet-public1-us-east-1a" }
}

data "aws_subnet" "public2" {
  vpc_id = data.aws_vpc.main.id
  tags   = { Name = "plate2home-subnet-public2-us-east-1b" }
}

data "aws_subnet" "private1" {
  vpc_id = data.aws_vpc.main.id
  tags   = { Name = "plate2home-subnet-private1-us-east-1a" }
}

data "aws_subnet" "private2" {
  vpc_id = data.aws_vpc.main.id
  tags   = { Name = "plate2home-subnet-private2-us-east-1b" }
}

data "aws_security_group" "alb" {
  vpc_id = data.aws_vpc.main.id
  name   = "plate2home-alb"
}

data "aws_security_group" "web" {
  vpc_id = data.aws_vpc.main.id
  name   = "plate2home-web"
}

data "aws_security_group" "db" {
  vpc_id = data.aws_vpc.main.id
  name   = "plate2home-db"
}

# Learner Lab can't create IAM roles; Lambda uses the existing LabRole.
data "aws_iam_role" "lab" {
  name = "LabRole"
}

output "found_vpc" {
  value = "${data.aws_vpc.main.id} · public ${data.aws_subnet.public1.id}, ${data.aws_subnet.public2.id} · private ${data.aws_subnet.private1.id}, ${data.aws_subnet.private2.id}"
}
