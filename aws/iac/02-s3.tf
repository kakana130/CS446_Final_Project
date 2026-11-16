# Step: Amazon S3 — the private bucket for plate photos.
#
# Learner Lab's service control policy denies s3:GetBucketObjectLockConfiguration, which the
# AWS provider's aws_s3_bucket reads after every create and refresh, so that resource fails
# here. The bucket is made with the AWS CLI instead (CloudShell has it), and removed again by
# `tofu destroy`.

locals {
  # Bucket names are global; the account number makes this one unique.
  crops_bucket = "plate2home-crops-${data.aws_caller_identity.me.account_id}"
}

resource "terraform_data" "crops" {
  input = local.crops_bucket

  # Create the bucket if it isn't there yet, then block every kind of public access: the app
  # shows photos only through short-lived signed links.
  provisioner "local-exec" {
    command = <<-EOT
      aws s3api head-bucket --bucket ${self.input} 2>/dev/null || aws s3api create-bucket --bucket ${self.input} --region us-east-1
      aws s3api put-public-access-block --bucket ${self.input} --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
    EOT
  }

  # `tofu destroy` empties and deletes it.
  provisioner "local-exec" {
    when    = destroy
    command = "aws s3 rb s3://${self.input} --force"
  }
}

output "s3_bucket" {
  value = terraform_data.crops.output
}
