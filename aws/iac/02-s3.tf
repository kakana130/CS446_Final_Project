# Step: Amazon S3 — the private bucket for plate photos.

resource "aws_s3_bucket" "crops" {
  # Bucket names are global; the account number makes this one unique.
  bucket        = "plate2home-crops-${data.aws_caller_identity.me.account_id}"
  force_destroy = true # `tofu destroy` empties it first
}

# Nothing in the bucket is public: the app shows photos through short-lived signed links.
resource "aws_s3_bucket_public_access_block" "crops" {
  bucket                  = aws_s3_bucket.crops.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

output "s3_bucket" {
  value = aws_s3_bucket.crops.bucket
}
