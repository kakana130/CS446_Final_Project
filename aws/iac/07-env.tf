# Step: the values for the app's .env on the EC2 build instance. Creates nothing.
#   tofu output -raw env_oneliner
# prints ONE line to paste on the instance after the first setup.sh run. It writes the values
# into /opt/plate2home/.env. (A one-liner, because pasting many lines into the browser terminal
# of EC2 Instance Connect can mangle them. `tofu output -raw env_commands` shows them readable.)

locals {
  env_commands = <<-EOT
    cd /opt/plate2home
    setenv() { if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi; }
    setenv APP_ORIGIN 'http://${aws_lb.web.dns_name}'
    setenv DATABASE_URL 'postgresql://postgres:${var.db_password}@${aws_db_instance.db.address}:5432/plate2home'
    setenv AWS_REGION 'us-east-1'
    setenv S3_BUCKET '${terraform_data.crops.output}'
    setenv NOTIFY_LAMBDA_NAME '${aws_lambda_function.notify.function_name}'
    setenv NEXT_PUBLIC_FEATURE_ALERTS 'true'
    setenv NEXT_PUBLIC_FEATURE_ACCOUNTS 'false'
    setenv CRON_SECRET '${random_password.cron_secret.result}'
    setenv IP_HASH_SECRET '${random_password.ip_hash_secret.result}'
    grep -E '^(APP_ORIGIN|S3_BUCKET|NOTIFY_LAMBDA_NAME)=' .env
  EOT
}

output "env_commands" {
  sensitive = true # holds the database password and the secrets
  value     = local.env_commands
}

output "env_oneliner" {
  sensitive = true
  value     = "echo '${base64encode(local.env_commands)}' | base64 -d > /tmp/p2h-env.sh && bash /tmp/p2h-env.sh; rm -f /tmp/p2h-env.sh"
}
