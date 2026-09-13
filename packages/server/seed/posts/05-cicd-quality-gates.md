One of the core fundamentals of DevOps is bridging the gaps between the devs and the Cloud, 𝗲𝗻𝘀𝘂𝗿𝗶𝗻𝗴 𝘁𝗵𝗮𝘁 𝗮𝗽𝗽 𝗱𝗲𝗽𝗹𝗼𝘆𝗺𝗲𝗻𝘁𝘀 𝗱𝗼𝗻'𝘁 𝘁𝗮𝗸𝗲 𝘂𝗽 𝘁𝗼 𝟮 𝗱𝗮𝘆𝘀 𝗯𝗲𝗳𝗼𝗿𝗲 𝘁𝗵𝗲𝘆 𝗿𝗲𝗳𝗹𝗲𝗰𝘁...and one of the ways to ensure that is via automation with CI/CD pipelines ♾️

I remember one of the advice I recieved from my superiors in a previous project, "𝘗𝘳𝘪𝘯𝘤𝘦, 𝘮𝘢𝘴𝘵𝘦𝘳 𝘵𝘩𝘦 𝘣𝘢𝘴𝘪𝘤𝘴 𝘢𝘯𝘥 𝘣𝘶𝘪𝘭𝘥 𝘶𝘱 𝘧𝘳𝘰𝘮 𝘵𝘩𝘦𝘳𝘦"

---

Sooo...here's the gist 👇🏾...

I recently got invited for an interview, and to properly prepare for it, I had to conclude a project which birthed 5 - 6 different case-studies and achievements.

To wrap up the project, I created...

 • CI/CD pipelines to auto-provision the Shared and per-environment (staging and prod) infrastructure on Google Cloud, using HashiCorp Terraform + Terragrunt on GitHub Actions

I implemented Quality Gates per environment deployment using GitHib Actions Environment workflows. 

Ensuring that before deployments are made to any environment (stage or prod), it is reviewed and approved by a team-lead.

This way environments like prod are protected against unapproved/un-reviewed deployments

 • Pipelines to automate the Continuous Deployment of microservices on the Kubernetes Cluster.

To prevent security vulnerabilities in the changes made and container image, I ran Semgrep SAST scans on the codebase and Trivy security scans on the container image

---

This project alone helped me explore different edge-cases across DevSecOps, Platform, and Site Reliability Engineering. I was able to...

 • 𝗣𝗿𝗼𝘁𝗲𝗰𝘁 𝘁𝗵𝗲 𝗖𝗹𝗼𝘂𝗱 𝗞𝘂𝗯𝗲𝗿𝗻𝗲𝘁𝗲𝘀 𝗶𝗻𝗳𝗿𝗮𝘀𝘁𝗿𝘂𝗰𝘁𝘂𝗿𝗲 𝗳𝗿𝗼𝗺 𝗮 𝘀𝗶𝗺𝘂𝗹𝗮𝘁𝗲𝗱 𝗗𝗗𝗼𝗦 𝗮𝘁𝘁𝗮𝗰𝗸, using Cloudflare WAF + Google Cloud Firewall; blocking 80% - 100% of the attack traffic

 • Engineer some microservices on Google Kuberentes, which 𝘀𝘂𝗰𝗰𝗲𝘀𝘀𝗳𝘂𝗹𝗹𝘆 𝗽𝗿𝗼𝗰𝗲𝘀𝘀𝗲𝗱 𝟭𝟲𝟬,𝟬𝟬𝟬+ 𝗿𝗲𝗾𝘂𝗲𝘀𝘁𝘀/𝗵𝗼𝘂𝗿 (𝗲𝗾𝘂𝗶𝘃𝗮𝗹𝗲𝗻𝘁 𝘁𝗼 𝟯.𝟴𝗠+ 𝗿𝗲𝗾𝘂𝗲𝘀𝘁𝘀 𝗶𝗻 𝗮 𝗱𝗮𝘆), at a 99.99% success rate

 • Ensure remote team members had private + secure 𝗮𝗰𝗰𝗲𝘀𝘀 𝘁𝗼 𝗶𝗻𝘁𝗲𝗿𝗻𝗮𝗹 𝗖𝗹𝗼𝘂𝗱 𝗿𝗲𝘀𝗼𝘂𝗿𝗰𝗲𝘀 𝗳𝗿𝗼𝗺 𝘁𝗵𝗲𝗶𝗿 𝗿𝗲𝗺𝗼𝘁𝗲 𝗱𝗲𝘃𝗶𝗰𝗲𝘀, 𝗲.𝗴. 𝗗𝗕𝘀, 𝗯𝗮𝗰𝗸𝗲𝗻𝗱 𝗔𝗣𝗜𝘀, 𝗲𝘁𝗰...𝘄𝗶𝘁𝗵𝗼𝘂𝘁 𝗲𝘅𝗽𝗼𝘀𝗶𝗻𝗴 𝗮𝗻𝘆 𝗼𝗳 𝘁𝗵𝗲𝗺 𝘁𝗼 𝘁𝗵𝗲 𝗶𝗻𝘁𝗲𝗿𝗻𝗲𝘁; by provisioning a NetBird VPN within the Cloud network

 • Engineer end-to-end Observability on my Cloud infrastructure, (from monitoring to incident response); 𝗰𝗼𝗻𝗳𝗶𝗴𝘂𝗿𝗶𝗻𝗴 𝟵𝟵.𝟵𝟱% 𝗮𝗻𝗱 𝟵𝟵% 𝗮𝘃𝗮𝗶𝗹𝗮𝗯𝗶𝗹𝗶𝘁𝘆 𝗮𝗻𝗱 𝗹𝗮𝘁𝗲𝗻𝗰𝘆 𝗦𝗟𝗢𝘀 𝗼𝗻 𝗰𝗿𝗶𝘁𝗶𝗰𝗮𝗹 𝘀𝗲𝗿𝘃𝗶𝗰𝗲𝘀, and measuring their SLIs in real-time

I made the codebase public and open-source, so everyone can learn from the architecture.

You can access the repo below; it contains each case-study which explain the various milestones achieved in the project 👇🏾
https://lnkd.in/dSpUf6G4
