# Step: Amazon RDS — the PostgreSQL database, in the two private subnets.

# The master password, from terraform.tfvars (letters and digits only).
variable "db_password" {
  type      = string
  sensitive = true
}

# Which private subnets RDS may use (one per AZ).
resource "aws_db_subnet_group" "db" {
  name       = "plate2home-db-subnets"
  subnet_ids = [data.aws_subnet.private1.id, data.aws_subnet.private2.id]
}

resource "aws_db_instance" "db" {
  identifier        = "plate2home-db"
  engine            = "postgres"
  engine_version    = "17"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  storage_type      = "gp2"

  db_name  = "plate2home" # the database the app uses (created empty; the app builds the tables)
  username = "postgres"
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.db.name
  vpc_security_group_ids = [data.aws_security_group.db.id] # 5432 only from plate2home-web
  publicly_accessible    = false

  backup_retention_period  = 1
  delete_automated_backups = true
  skip_final_snapshot      = true # so `tofu destroy` can delete it without a snapshot
  apply_immediately        = true
}

output "rds_endpoint" {
  value = aws_db_instance.db.address
}
