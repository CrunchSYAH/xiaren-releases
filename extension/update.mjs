import { releaseRepository } from './release-config.mjs';

const version = globalThis.chrome?.runtime?.getManifest?.().version || '预览';
const versionLabel = document.getElementById('extension-version');
if (versionLabel) versionLabel.textContent = `当前版本 ${version}`;
const releaseLink = document.getElementById('latest-release');
if (releaseLink && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(releaseRepository)) {
  releaseLink.href = `https://github.com/${releaseRepository}/releases/latest`;
  releaseLink.hidden = false;
  document.getElementById('release-unavailable').hidden = true;
}
