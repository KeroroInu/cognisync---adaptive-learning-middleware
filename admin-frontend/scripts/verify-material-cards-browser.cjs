// Compatibility entry point: material-card QA now includes the participation regression.
// Both names run synthetic fixtures only and never contact a classroom server.
if (!process.env.DIST_DIR && process.env.ADMIN_BUILD_DIR) process.env.DIST_DIR = process.env.ADMIN_BUILD_DIR;
if (process.env.MATERIAL_QA_BASELINE === '1') {
  console.warn('MATERIAL_QA_BASELINE=1 is deprecated: running the full current material/participation regression and responsive screenshots instead.');
}
require('./verify-participation-browser.cjs');
