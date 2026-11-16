# Step: the values for the app's .env on the EC2 build instance. Creates nothing.
#   tofu output -raw env_commands
# prints commands to paste on the instance, in /opt/plate2home, after the first setup.sh run.

output "env_commands" {
  sensitive = true # holds the database password and the secrets
  value     = <<-EOT
    cd /opt/plate2home
    setenv() { if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi; }
    setenv APP_ORIGIN 'http://${aws_lb.web.dns_name}'
    setenv DATABASE_URL 'postgresql://postgres:${var.db_password}@${aws_db_instance.db.address}:5432/plate2home'
    setenv AWS_REGION 'us-east-1'
    setenv S3_BUCKET '${aws_s3_bucket.crops.bucket}'
    setenv NOTIFY_LAMBDA_NAME '${aws_lambda_function.notify.function_name}'
    setenv NEXT_PUBLIC_FEATURE_ALERTS 'true'
    setenv NEXT_PUBLIC_FEATURE_ACCOUNTS 'false'
    setenv CRON_SECRET '${random_password.cron_secret.result}'
    setenv IP_HASH_SECRET '${random_password.ip_hash_secret.result}'
    grep -E '^(APP_ORIGIN|S3_BUCKET|NOTIFY_LAMBDA_NAME)=' .env
  EOT
}
