# Step: AWS Lambda plate2home-cleanup + Amazon EventBridge — the daily retention job.

# The app's two secrets (they also go into .env in the next step).
resource "random_password" "cron_secret" {
  length  = 48
  special = false
}

resource "random_password" "ip_hash_secret" {
  length  = 48
  special = false
}

data "archive_file" "cleanup" {
  type        = "zip"
  source_file = "${local.repo}/aws/lambda/cleanup/index.mjs"
  output_path = "${path.module}/build/cleanup.zip"
}

# Calls http://<ALB>/api/cron/retention with the CRON_SECRET.
resource "aws_lambda_function" "cleanup" {
  function_name    = "plate2home-cleanup"
  role             = data.aws_iam_role.lab.arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  filename         = data.archive_file.cleanup.output_path
  source_code_hash = data.archive_file.cleanup.output_base64sha256
  timeout          = 60

  environment {
    variables = {
      APP_URL     = "http://${aws_lb.web.dns_name}"
      CRON_SECRET = random_password.cron_secret.result
    }
  }
}

# Every day at 03:00 Bangkok time. EventBridge rules use UTC: 20:00 UTC = 03:00 (UTC+7).
resource "aws_cloudwatch_event_rule" "daily" {
  name                = "plate2home-daily-cleanup"
  schedule_expression = "cron(0 20 * * ? *)"
}

resource "aws_cloudwatch_event_target" "cleanup" {
  rule = aws_cloudwatch_event_rule.daily.name
  arn  = aws_lambda_function.cleanup.arn
}

# Lets EventBridge invoke the function (a rule needs no IAM role).
resource "aws_lambda_permission" "events" {
  statement_id  = "AllowEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.cleanup.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily.arn
}
