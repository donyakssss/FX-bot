process.env.ENABLE_AUTO_EXECUTION = 'true';
(async () => {
  await import('./dry_run_multi.js');
})();
