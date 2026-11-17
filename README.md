# Plate2Home: CS446 Final Project

Set-up instructions for deploying Plate2Home on AWS (Learner Lab, us-east-1), by **BBQ Make Friends**.

**Slides (PDF):** [`docs/slides/CS446_Final_Project_Plate2Home.pdf`]([docs/slides/CS446_Final_Project_Plate2Home.pdf](https://drive.google.com/file/d/1VuJqN_zSlZ_m-Atmf4c_DrwXjTQoV6sI/view?usp=sharing))

> The long `echo '…'` line on slides 14, 15 and 17 is hidden: it holds the database password and app
> secrets. Yours is printed by `1-create.sh` in CloudShell.

![Plate2Home: Set up instructions](docs/slides/01.jpg)

### Plate2Home Website Overview

![Plate2Home Website Overview](docs/slides/02.jpg)

### AWS Service List

![AWS Service List](docs/slides/03.jpg)

### AWS Architecture diagram

![AWS Architecture diagram](docs/slides/04.jpg)

### Set up Guide: the 8 steps

![Set up Guide: the 8 steps](docs/slides/05.jpg)

### 1. สร้าง VPC

![1. สร้าง VPC](docs/slides/06.jpg)

### 2. Security Group 1: plate2home-alb

![2. Security Group 1: plate2home-alb](docs/slides/07.jpg)

### 2. Security Group 2: plate2home-web

![2. Security Group 2: plate2home-web](docs/slides/08.jpg)

### 2. Security Group 2: plate2home-web (inbound rules)

![2. Security Group 2: plate2home-web (inbound rules)](docs/slides/09.jpg)

### 2. Security Group 3: plate2home-db

![2. Security Group 3: plate2home-db](docs/slides/10.jpg)

### 3. สร้าง EC2

![3. สร้าง EC2](docs/slides/11.jpg)

### 3. สร้าง EC2: Network settings

![3. สร้าง EC2: Network settings](docs/slides/12.jpg)

### 3. สร้าง EC2: storage and IAM profile

![3. สร้าง EC2: storage and IAM profile](docs/slides/13.jpg)

### 4. CloudShell รอบ 1

![4. CloudShell รอบ 1](docs/slides/14.jpg)

### 4. CloudShell รอบ 1: copy the long line

![4. CloudShell รอบ 1: copy the long line](docs/slides/15.jpg)

### 5. EC2 Instance Connect

![5. EC2 Instance Connect](docs/slides/16.jpg)

### 5. EC2 Instance Connect: paste and wait

![5. EC2 Instance Connect: paste and wait](docs/slides/17.jpg)

### 6. CloudShell รอบ 2

![6. CloudShell รอบ 2](docs/slides/18.jpg)

### 7. Open Website

![7. Open Website](docs/slides/19.jpg)

### 8. Clean up

![8. Clean up](docs/slides/20.jpg)

### Troubleshooting

![Troubleshooting](docs/slides/21.jpg)

### Troubleshooting: CloudShell เต็ม

![Troubleshooting: CloudShell เต็ม](docs/slides/22.jpg)

### Troubleshooting: เริ่มใหม่ทั้งหมด

![Troubleshooting: เริ่มใหม่ทั้งหมด](docs/slides/23.jpg)

### Thank you

![Thank you](docs/slides/24.jpg)

---

More: [project overview](docs/project-overview.md) (features, stack, local development) ·
[AWS-DEPLOY.md](AWS-DEPLOY.md) (console steps) · [aws/iac/README.md](aws/iac/README.md) (OpenTofu files and scripts)
