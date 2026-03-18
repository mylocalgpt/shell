/**
 * Bundle size verification script.
 * Builds the project with tsdown and verifies the gzipped entry point
 * is under the size limit.
 *
 * Usage: node scripts/check-bundle-size.mjs
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const MAX_GZIP_BYTES = 150 * 1024; // 150KB

// Build
console.log('Building...');
execSync('npx tsdown', { stdio: 'inherit' });

// Measure main entry
const entry = readFileSync('dist/index.mjs');
const gzipped = gzipSync(entry);
const uncompressedKB = (entry.length / 1024).toFixed(1);
const gzippedKB = (gzipped.length / 1024).toFixed(1);

console.log(`\nBundle size:`);
console.log(`  dist/index.mjs: ${uncompressedKB} KB (${gzippedKB} KB gzipped)`);

if (gzipped.length > MAX_GZIP_BYTES) {
	console.error(`\nFAIL: Gzipped size ${gzippedKB} KB exceeds limit of ${MAX_GZIP_BYTES / 1024} KB`);
	process.exit(1);
} else {
	console.log(`\nPASS: Under ${MAX_GZIP_BYTES / 1024} KB gzipped limit`);
}
