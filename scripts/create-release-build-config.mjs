import fs from 'node:fs';
import { createReleaseBuildConfig } from './lib/release-build-config.mjs';
import { verifyLicenseBundle } from './lib/release-evidence.mjs';
verifyLicenseBundle('src-tauri/licenses');
const base = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const version = process.argv[3] || undefined;
const signing = !version && process.env.YTDL_SIGN_CONFIG
  ? JSON.parse(fs.readFileSync(process.env.YTDL_SIGN_CONFIG, 'utf8').replace(/^\uFEFF/, '')) : undefined;
fs.writeFileSync(process.argv[2], JSON.stringify(createReleaseBuildConfig(base, { version, signing })));
