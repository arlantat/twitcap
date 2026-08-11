#!/usr/bin/env npx tsx
/**
 * Scaffold a new domain memory pack:
 *   npm run domain:new -- <slug> "Optional Title"
 * Then edit domain/packs/<slug>/profile.md to describe the streams.
 */

import path from "path";
import { createDomainPack } from "../src/lib/domainPacks";

const slug = process.argv[2];
const title = process.argv[3];

if (!slug) {
  console.error('Usage: npm run domain:new -- <slug> "Optional Title"');
  process.exit(1);
}

const raw = process.env.DOMAIN_DIR || "./domain";
const root = path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);

try {
  const dir = createDomainPack(root, slug, title);
  console.log(`Created ${dir}`);
  console.log(`Next: edit ${path.join(dir, "profile.md")} to describe the domain.`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
