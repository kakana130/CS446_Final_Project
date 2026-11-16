# Step: launch template + Auto Scaling group, from the AMI of the build instance.

# The AMI made from plate2home-build, from terraform.tfvars.
variable "ami_id" {
  type = string
}

resource "aws_launch_template" "web" {
  name                   = "plate2home-lt"
  image_id               = var.ami_id
  instance_type          = "t3.small"
  key_name               = "vockey"
  vpc_security_group_ids = [data.aws_security_group.web.id]
  update_default_version = true

  # Lets the app reach S3 and Lambda without access keys.
  iam_instance_profile {
    name = "LabInstanceProfile"
  }

  tag_specifications {
    resource_type = "instance"
    tags          = { Name = "plate2home-web" }
  }
}

# Two instances (one per AZ), up to four under load, registered in the target group.
resource "aws_autoscaling_group" "web" {
  name                      = "plate2home-asg"
  min_size                  = 2
  max_size                  = 4
  desired_capacity          = 2
  vpc_zone_identifier       = [data.aws_subnet.public1.id, data.aws_subnet.public2.id]
  target_group_arns         = [aws_lb_target_group.web.arn]
  health_check_type         = "ELB"
  health_check_grace_period = 120

  launch_template {
    id      = aws_launch_template.web.id
    version = aws_launch_template.web.latest_version
  }

  # A new AMI (new template version) replaces the instances one at a time.
  instance_refresh {
    strategy = "Rolling"
    preferences {
      min_healthy_percentage = 50
    }
  }
}

# Add instances when the average CPU goes above 60%.
resource "aws_autoscaling_policy" "cpu" {
  name                   = "plate2home-cpu-60"
  autoscaling_group_name = aws_autoscaling_group.web.name
  policy_type            = "TargetTrackingScaling"

  target_tracking_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ASGAverageCPUUtilization"
    }
    target_value = 60
  }
}
