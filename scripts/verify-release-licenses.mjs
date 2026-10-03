import { verifyLicenseBundle } from './lib/release-evidence.mjs';
const manifest = verifyLicenseBundle(process.argv[2]);
console.log(`License payload verified: ${manifest.files.length} files, version ${manifest.version}`);
