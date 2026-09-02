𝗖𝗧𝗢𝘀 𝗮𝗻𝗱 𝗦𝗶𝘁𝗲 𝗥𝗲𝗹𝗶𝗮𝗯𝗶𝗹𝗶𝘁𝘆 𝗘𝗻𝗴𝗶𝗻𝗲𝗲𝗿𝘀...𝘆𝗼𝘂 𝗺𝗶𝗴𝗵𝘁 𝘄𝗮𝗻𝘁 𝘁𝗼 𝘀𝗲𝗲 𝘁𝗵𝗶𝘀 🌚
How I configured and tracked target Objectives (SLOs) in my GKE infrastructure, to accurately measure its Reliability, 𝗮𝗻𝗱 𝗵𝗼𝘄 𝗶𝘁 𝗰𝗼𝘂𝗹𝗱 𝗯𝗲𝗻𝗲𝗳𝗶𝘁 𝘆𝗼𝘂𝗿 𝗼𝗿𝗴 𝘀𝗲𝘁𝘂𝗽 :) 👇🏾

Soo, how it all began...

I set up the infra on Google Cloud Kubernetes (Official) Engine (GKE), then implemented monitoring and alerting of the infra metrics, logs, and events using Prometheus, Grafana, Loki, and Kubernetes Events Exporter, sending alerts to Slack

To ensure the high-priority apps were reliable, I...

 • Engineered a Regional cluster with worker nodes across various zones to withstand zonal failures

 • Right sized pod resources requests and limits to prevent too many pods from being scheduled on a single node (which could lead to resource contention during spikes)

 • Ran the high-priority apps, e.g. the DBs with a higher Priority Class to ensure they get scheduled quickly, and don't easily get evicted

 • Ran 2 - 3 replicas of the critical apps across various nodes across various zones with a PDB, to ensure even if 1 node goes down, its other replicas would be up and prevent downtime

To effectively measure the reliability of the high-priority apps which could affect the customers, e.g. the DB cluster, microservices, etc, I defined Service Level Objectives for their availability and latency using the Sloth tool + Prometheus & Istio to get the Service Level Indicators metrics.

I also created Grafana alert rules to track the apps SLI error ratios and send alerts to the Slack channel when the error budget burn rates exceed certain thresholds.

Honestly, this broadened my horizon on Site Reliability Engineering, I learnt various ways to measure if the apps in the cluster are actually as reliabile as they were configured, learning concepts such as calculating... 

 • The Error Budget of an app from its SLO
 • An app's Error Rate
 • The error budget burn rate, etc...

---
𝗛𝗼𝘄 𝘁𝗵𝗶𝘀 𝗰𝗼𝘂𝗹𝗱 𝗯𝗲𝗻𝗲𝗳𝗶𝘁 𝘆𝗼𝘂𝗿 𝗰𝗼𝗺𝗽𝗮𝗻𝘆'𝘀 𝗶𝗻𝗳𝗿𝗮 𝘀𝗲𝘁 𝘂𝗽?

 • Highlight critical, high-priority apps (e.g. customer facing - Ingress/API Gateways, DB Clusters, microservices, etc..), and schedule them on the cluster in ways which will increase their reliability

 • Define Service Level Objectives for these apps to properly track and measure their reliability using their SLIs

 • Define alert rules which would fire and page the team when these critical apps burn through their monthly error budget too fast

#CTOs #CEOs #VPEngineering #SiteReliabilityEngineering
