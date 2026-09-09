data "aws_vpc" "main" {
  filter {
    name   = "tag:Name"
    values = ["main"]
  }
}

data "aws_subnet" "sub_a" {
  vpc_id = data.aws_vpc.main.id

  filter {
    name   = "tag:Name"
    values = ["sub_a"]
  }
}

data "aws_subnet" "sub_b" {
  vpc_id = data.aws_vpc.main.id

  filter {
    name   = "tag:Name"
    values = ["sub_b"]
  }
}

data "aws_security_group" "rds" {
  vpc_id = data.aws_vpc.main.id

  filter {
    name   = "tag:Name"
    values = ["rds"]
  }
}

data "aws_db_instance" "main" {
  db_instance_identifier = var.db_identifier
}
