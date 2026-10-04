console.error(`Desktop compatibility requires live host observations, not a browser preview.
Follow docs/desktop-compatibility.md and record all eight gate results.
This command does not launch a hosted service or bypass Desktop access restrictions.
Automated checks alone cannot mark the Desktop gate passed.`);
process.exitCode = 2;
