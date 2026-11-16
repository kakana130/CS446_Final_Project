# Step: Elastic Load Balancing — target group, Application Load Balancer, listener.
# The ALB's DNS name is the site's address.

# The web instances, checked on /api/health.
resource "aws_lb_target_group" "web" {
  name     = "plate2home-tg"
  port     = 80
  protocol = "HTTP"
  vpc_id   = data.aws_vpc.main.id

  health_check {
    path                = "/api/health"
    matcher             = "200"
    healthy_threshold   = 2
    unhealthy_threshold = 2
    interval            = 15
  }
}

# Internet-facing, in both public subnets (an ALB needs two AZs).
resource "aws_lb" "web" {
  name               = "plate2home-alb"
  load_balancer_type = "application"
  internal           = false
  subnets            = [data.aws_subnet.public1.id, data.aws_subnet.public2.id]
  security_groups    = [data.aws_security_group.alb.id] # HTTP 80 from anywhere
}

# HTTP :80 → the target group.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.web.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

output "site_url" {
  value = "http://${aws_lb.web.dns_name}"
}
