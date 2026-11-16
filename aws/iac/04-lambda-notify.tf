# Step: AWS Lambda plate2home-notify — the web app calls it; it subscribes owners and
# publishes match alerts to the SNS topic.

# Zip aws/lambda/notify/index.mjs from the cloned repository.
data "archive_file" "notify" {
  type        = "zip"
  source_file = "${local.repo}/aws/lambda/notify/index.mjs"
  output_path = "${path.module}/build/notify.zip"
}

resource "aws_lambda_function" "notify" {
  function_name    = "plate2home-notify"
  role             = data.aws_iam_role.lab.arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  filename         = data.archive_file.notify.output_path
  source_code_hash = data.archive_file.notify.output_base64sha256
  timeout          = 30

  environment {
    variables = { TOPIC_ARN = aws_sns_topic.alerts.arn }
  }
}

output "notify_lambda" {
  value = aws_lambda_function.notify.function_name
}
