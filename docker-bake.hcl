// Builds the server and web images for both architectures as separate,
// independently-tagged images (not one multi-arch manifest) — each target
// below is pinned to exactly one platform, which is what lets `--load` work
// for all of them in a single `docker buildx bake --load` run.
//
// amd64 targets carry the real GHCR tag (what actually gets deployed to
// Fargate, which runs amd64); arm64 targets stay local-only, for running the
// images natively on an Apple Silicon Mac without emulation.

group "default" {
  targets = ["server-amd", "server-arm", "web-amd", "web-arm"]
}

target "server-amd" {
  context    = "."
  dockerfile = "packages/server/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = ["ghcr.io/conflow-oss/conflow/server:1"]
}

target "server-arm" {
  context    = "."
  dockerfile = "packages/server/Dockerfile"
  platforms  = ["linux/arm64"]
  tags       = ["content-engine-server:arm-v1"]
}

target "web-amd" {
  context    = "."
  dockerfile = "packages/web/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = ["ghcr.io/conflow-oss/conflow/webserver:1"]
}

target "web-arm" {
  context    = "."
  dockerfile = "packages/web/Dockerfile"
  platforms  = ["linux/arm64"]
  tags       = ["content-generation-tool-web:arm-v1"]
}
