• What if your org. could achieve quicker mean-time-to-recovery during system downtime, due to system events being stored (logging)?

 • What if your team could quickly and easily trace failed customer requests through the microservices when trying to resolve issues??

 • What if your company could properly track how reliable and resilient its applications are in real-time instead of assuming 99% availability or low-latency???

Yup! All these mentioned above are the advantages your company infrastructure gets from implementing Observability, giving you...

 • Proper insights into your application states and health, and...
 • Enabling the team make data-driven decision instead of 2nd guessing

That was why I engineered end-to-end Observability - monitoring metrics, logging events, tracing requests, setting objectives, and incident response, on my infrastructure.

𝗢𝘆𝗮, 𝘄𝗮𝗹𝗸 𝘄𝗶𝘁𝗵 𝗺𝗲 🚶🏾‍♂️👇🏾...

After engineering microservices and databases on Google Kubernetes Engine cluster, I needed a way to properly monitor the health of the applications on the cluster 24/7 without me always being present. So I...

 • Monitored the health of all the containers running in the cluster using Prometheus, and visualised the metrics on Grafana Labs

 • Persisted app logs on Google Cloud Storage via Loki, retrieving them using Alloy

 • Traced the customer requests passing through the microservices in the cluster, for easier and faster debugging; using Istio sidecars, Jaeger + Kiali

 • I needed the system to auto-inform the engineers whenever potential issues arose; so I configured Grafana Alerting and integrated it with the team's Slack channel

 • We also needed to properly measure the apps reliability, and not just assume '99% availability'...this would also 𝗲𝗻𝘀𝘂𝗿𝗲 𝘄𝗲 𝗸𝗲𝗽𝘁 𝘁𝗼 𝗼𝘂𝗿 𝗲𝗻𝗱 𝗼𝗳 𝘁𝗵𝗲 𝗰𝘂𝘀𝘁𝗼𝗺𝗲𝗿'𝘀 𝗦𝗟𝗔𝘀.

 • Hence, we set target Objectives and error-budgets for each critical customer-facing app (99.5% availability and 99% latency targets), and monitored their SLI metrics using Prometheus + Sloth

 • We also needed to be able to quickly respond to incidents in the system before they escalate to the customers

 • So...we provisioned PagerDuty for incident response, configuring on-call rotation and workflows to automate the creation of Slack channels per critical incident, so engineers could collaborate in resolving it

---

You can learn more about the project from the case study below, where I shared: 
what was implemented, 
the challenges encountered, 
and how this setup could benefit your company infrastructure 👇🏾

https://lnkd.in/e_2snwiQ

#DevOps #Observability #CTOs #CTO #VPEngineering #Kubernetes
