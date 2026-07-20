# Release checklist

- [ ] Run `pnpm run format:check`, `pnpm --filter client lint`,
      `pnpm --filter client typecheck`, `pnpm run test:coverage`, `pnpm run test:data`,
      `pnpm run validate:data`, `pnpm run build`, and `pnpm audit --audit-level high`.
- [ ] Review `node scripts/validate-data.mjs --report=json`, including primary anchor, graph counts,
      unreachable nodes, and canonical routes.
- [ ] Run `pnpm run test:e2e`, including the offline service-worker reload scenario.
- [ ] Confirm the axe accessibility scan in `pnpm run test:e2e` passes.
- [ ] Confirm the GitHub `production` environment has the required reviewer policy and a
      `CLOUDFLARE_API_TOKEN` secret before promoting `main`.
- [ ] Confirm production security headers from `worker/index.ts` after deployment.
- [ ] Confirm the service-worker update succeeds and a previously loaded app works while offline.
- [ ] Confirm public floor-plan exposure remains approved for this release.
- [ ] If wall data changed, confirm the pull request records its approved source and route-geometry
      effect.
- [ ] Confirm developer-tool access has not been used as authorization for persistent writes.
