import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@ai-office/shared"],
  // `pnpm start` builds into .next-prod so a running `next dev` (.next) and the production build never overwrite each other
  distDir: process.env.AI_OFFICE_WEB_DIST || ".next",
};

export default config;
