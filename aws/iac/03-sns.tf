# Step: Amazon SNS — the topic that emails owners when their plate is found.
# No subscriptions here: the notify Lambda subscribes each owner who ticks the checkbox.

resource "aws_sns_topic" "alerts" {
  name         = "plate2home-alerts"
  display_name = "Plate2Home" # sender name on the confirmation and alert emails
}

output "sns_topic_arn" {
  value = aws_sns_topic.alerts.arn
}
