import chevron from './assets/chevron.svg';
import { cssUrl } from './icons.js';

// Panel tokens resolve to the host's MCP Apps style variables first, so the panel
// takes Codex's own colours, type and radii. The fallbacks only apply when the
// host sends none.
type Palette = Record<string, [hostVariable: string, fallback: string]>;

const light: Palette = {
  ink: ['--color-text-primary', '#1d1d1f'],
  muted: ['--color-text-secondary', '#6e6e73'],
  faint: ['--color-text-tertiary', '#8e8e93'],
  surface: ['--color-background-primary', '#ffffff'],
  card: ['--color-background-secondary', '#f6f6f7'],
  fill: ['--color-background-tertiary', 'rgba(0,0,0,.05)'],
  line: ['--color-border-secondary', 'rgba(0,0,0,.08)'],
  'line-strong': ['--color-border-primary', 'rgba(0,0,0,.14)'],
  ring: ['--color-ring-primary', '#5b60be'],
  accent: ['--color-text-info', '#5b60be'],
  'info-bg': ['--color-background-info', '#e9f2ff'],
  'info-ink': ['--color-text-info', '#286cc4'],
  'success-bg': ['--color-background-success', '#e4f5eb'],
  'success-ink': ['--color-text-success', '#237047'],
  'warning-bg': ['--color-background-warning', '#fdf3df'],
  'warning-ink': ['--color-text-warning', '#85591a'],
  'danger-bg': ['--color-background-danger', '#ffebeb'],
  'danger-ink': ['--color-text-danger', '#b0302f'],
};

const dark: Palette = {
  ink: ['--color-text-primary', '#f2f2f4'],
  muted: ['--color-text-secondary', '#a1a1a8'],
  faint: ['--color-text-tertiary', '#7c7c84'],
  surface: ['--color-background-primary', '#1e1e20'],
  card: ['--color-background-secondary', '#262628'],
  fill: ['--color-background-tertiary', 'rgba(255,255,255,.07)'],
  line: ['--color-border-secondary', 'rgba(255,255,255,.08)'],
  'line-strong': ['--color-border-primary', 'rgba(255,255,255,.16)'],
  ring: ['--color-ring-primary', '#a9acf2'],
  accent: ['--color-text-info', '#a9acf2'],
  'info-bg': ['--color-background-info', '#1f3350'],
  'info-ink': ['--color-text-info', '#9cc3f5'],
  'success-bg': ['--color-background-success', '#1d3828'],
  'success-ink': ['--color-text-success', '#9dd5b4'],
  'warning-bg': ['--color-background-warning', '#3a2f1c'],
  'warning-ink': ['--color-text-warning', '#ebcf98'],
  'danger-bg': ['--color-background-danger', '#43262a'],
  'danger-ink': ['--color-text-danger', '#ffaeae'],
};

const tokens = (palette: Palette) =>
  Object.entries(palette)
    .map(([name, [host, fallback]]) => `--${name}:var(${host},${fallback})`)
    .join(';');

const theme = `
:root{color-scheme:light dark;interpolate-size:allow-keywords;${tokens(light)};--font:var(--font-sans,-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif);--mono:var(--font-mono,ui-monospace,"SF Mono",Menlo,monospace);--radius-sm:var(--border-radius-sm,5px);--radius-md:var(--border-radius-md,8px);--radius-lg:var(--border-radius-lg,12px);--shadow:var(--shadow-sm,0 1px 2px rgba(0,0,0,.05),0 0 0 .5px rgba(0,0,0,.04));--text:var(--font-text-sm-size,13px);--text-xs:var(--font-text-xs-size,11px);--heading:var(--font-heading-xs-size,14px);--ease:cubic-bezier(.2,.8,.2,1)}
:root[data-theme=dark]{color-scheme:dark;${tokens(dark)}}
:root[data-theme=light]{color-scheme:light}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){${tokens(dark)}}}
html,body{margin:0;background:var(--surface)}*{box-sizing:border-box}[hidden]{display:none!important}
`;

const base = `
main.ultra-panel{container-type:inline-size;min-height:100vh;color:var(--ink);background:var(--surface);font:var(--text)/1.45 var(--font);-webkit-font-smoothing:antialiased;overflow-wrap:anywhere;cursor:default}
.ultra-panel h1,.ultra-panel h2,.ultra-panel h3,.ultra-panel h4,.ultra-panel h5{margin:0;font-weight:600;letter-spacing:-.01em}.ultra-panel h1{font-size:var(--text)}.ultra-panel h2{font-size:var(--heading);line-height:1.35}.ultra-panel h3{font-size:var(--heading);margin:10px 0 8px}.ultra-panel h4,.ultra-panel h5{font-size:var(--text-xs);color:var(--muted);margin:12px 0 4px}.run-details>h4{margin:0}.ultra-panel p{margin:0}.ultra-panel a{color:var(--accent);text-decoration:none}.ultra-panel a:hover{text-decoration:underline}
.icon{display:inline-block;flex:none;background:currentColor;-webkit-mask:var(--icon) center/contain no-repeat;mask:var(--icon) center/contain no-repeat;transition:transform .18s var(--ease)}.icon-spark{color:var(--accent)}.icon-running{color:var(--info-ink);animation:ultra-spin 1.1s linear infinite}
.ultra-panel button{display:inline-flex;align-items:center;gap:6px;font:500 12px/1 var(--font);height:26px;padding:0 10px;border:0;border-radius:var(--radius-md);background:var(--fill);color:var(--ink);cursor:default;transition:background-color .12s,transform .08s,opacity .12s;-webkit-user-select:none;user-select:none}
.ultra-panel button:hover{background:color-mix(in srgb,var(--ink) 9%,transparent)}.ultra-panel button:active:not(:disabled){transform:scale(.97);background:color-mix(in srgb,var(--ink) 13%,transparent)}.ultra-panel button:disabled{opacity:.45}.ultra-panel button[aria-label^="Cancel "]{color:var(--danger-ink)}
.ultra-panel :focus-visible{outline:2px solid var(--ring);outline-offset:2px;border-radius:var(--radius-sm)}
.ultra-panel .quiet-button,.ultra-panel .disclosure-button{background:transparent;color:var(--muted);padding:0 6px}.ultra-panel .quiet-button:hover,.ultra-panel .disclosure-button:hover{color:var(--ink)}.disclosure-button[aria-expanded=true] .icon-chevron{transform:rotate(90deg)}
.ultra-panel details{margin:0}.ultra-panel summary{display:flex;align-items:center;gap:6px;list-style:none;font-size:12px;color:var(--muted);padding:3px 0;transition:color .12s}.ultra-panel summary:hover{color:var(--ink)}.ultra-panel summary::-webkit-details-marker{display:none}
.ultra-panel summary:not(:has(.icon-chevron))::before{content:"";width:12px;height:12px;flex:none;background:currentColor;-webkit-mask:var(--chevron) center/contain no-repeat;mask:var(--chevron) center/contain no-repeat;transition:transform .18s var(--ease)}
.ultra-panel details[open]>summary .icon-chevron,.ultra-panel details[open]>summary::before{transform:rotate(90deg)}
.ultra-panel details::details-content{block-size:0;overflow:hidden;opacity:0;transition:block-size .22s var(--ease),opacity .18s,content-visibility .22s allow-discrete}.ultra-panel details[open]::details-content{block-size:auto;opacity:1}
.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
`;

const layout = `
.ultra-header{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px;padding:8px 16px;background:color-mix(in srgb,var(--surface) 78%,transparent);-webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px);border-bottom:1px solid var(--line)}.ultra-brand{display:flex;align-items:center;gap:7px}
.workflow-dashboard{min-height:100vh;display:flex;flex-direction:column}.dashboard-content{flex:1;width:100%;max-width:760px;margin:0 auto;padding:14px 16px 20px;display:flex;flex-direction:column;gap:12px}.history-title{font-size:var(--text)!important;color:var(--muted)}
.workflow-run{background:var(--card);border:1px solid var(--line);border-radius:var(--radius-lg);box-shadow:var(--shadow);padding:16px;display:flex;flex-direction:column;gap:14px;overflow:clip;transition:border-color .2s,box-shadow .2s;animation:ultra-rise .28s var(--ease)}.workflow-run:hover{border-color:var(--line-strong)}
.workflow-run-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.run-overview{display:flex;flex-direction:column;gap:14px}.run-overview.returned{animation:ultra-pop .24s var(--ease)}.run-title{min-width:0;display:flex;flex-direction:column;gap:3px}.run-eyebrow{font-size:var(--text-xs);font-weight:600;color:var(--muted)}.run-eyebrow.attention-ink{color:var(--warning-ink)}
.run-summary{display:flex;flex-direction:column;align-items:stretch;gap:12px}.run-result{display:flex;flex-direction:column;gap:8px;padding-bottom:14px;border-bottom:1px solid var(--line)}.run-result-summary{font-size:var(--text);line-height:1.5;white-space:pre-line}
.agent-summary-heading{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.agent-summary-copy{display:flex;flex-direction:column;gap:1px;font-size:12px}.agent-preview:empty{display:none}.agent-preview{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.run-meta{display:flex;align-items:center;justify-content:space-between;gap:6px 10px;flex-wrap:wrap}.run-counters{font-size:12px;font-variant-numeric:tabular-nums}.ultra-panel .disclosure-button{align-self:flex-start;margin-left:-6px}
.workflow-muted,.workflow-task-model,.workflow-source{color:var(--muted)}.workflow-error{color:var(--danger-ink)}.workflow-waiting{color:var(--warning-ink)}.empty-state{color:var(--muted);padding:32px 0;text-align:center}
.run-attention{display:flex;gap:8px;align-items:flex-start;padding:10px 12px;border-radius:var(--radius-md);background:var(--warning-bg);color:var(--warning-ink);font-size:12px}.run-attention .icon{margin-top:1px}.run-attention strong{display:block;color:var(--ink);font-weight:600;margin-bottom:2px}
.workflow-controls{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding-top:10px}
.ultra-footer{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;color:var(--muted);font-size:var(--text-xs);padding:10px 16px;border-top:1px solid var(--line)}.ultra-footer details{max-width:80%}.ultra-footer summary{font-size:var(--text-xs)}.ultra-footer p{padding:4px 0 0 18px}.ultra-footer>span{white-space:nowrap}.binding-status{padding:0 16px}
`;

const agents = `
.ultra-panel .agent-square{justify-content:center;width:22px;height:22px;padding:0;gap:0;border-radius:6px;border:1px solid var(--line-strong);background:var(--surface);color:var(--muted);font-weight:700;font-size:11px;transition:transform .12s var(--ease),box-shadow .12s}
.ultra-panel .agent-square:hover{transform:translateY(-1px) scale(1.06);box-shadow:var(--shadow);background:var(--surface)}
.ultra-panel .agent-square.agent-running{background:var(--info-bg);border-color:color-mix(in srgb,var(--info-ink) 35%,transparent);color:var(--info-ink)}.ultra-panel .agent-square.agent-completed{background:var(--success-bg);border-color:color-mix(in srgb,var(--success-ink) 30%,transparent);color:var(--success-ink)}
.ultra-panel .agent-square.agent-waiting,.ultra-panel .agent-square.agent-needs_reconciliation{background:var(--warning-bg);border-color:color-mix(in srgb,var(--warning-ink) 35%,transparent);color:var(--warning-ink)}.ultra-panel .agent-square.agent-failed{background:var(--danger-bg);border-color:color-mix(in srgb,var(--danger-ink) 35%,transparent);color:var(--danger-ink)}
.agent-dots{display:flex;gap:2px}.agent-dots i{width:3px;height:3px;border-radius:50%;background:currentColor;animation:ultra-pulse 1.2s ease-in-out infinite}.agent-dots i:nth-child(2){animation-delay:.15s}.agent-dots i:nth-child(3){animation-delay:.3s}
.agent-list{display:flex;flex-direction:column}.ultra-panel .agent-row{display:flex;align-items:center;gap:10px;height:auto;text-align:left;width:calc(100% + 12px);margin:0 -6px;padding:8px 6px;background:transparent;border-radius:var(--radius-md);font-weight:400;line-height:1.4}.ultra-panel .agent-row:hover{background:color-mix(in srgb,var(--ink) 6%,transparent)}
.agent-row-copy{flex:1;min-width:0;font-size:var(--text)}.agent-row-copy>span,.agent-row-copy>small{display:block}.agent-row-copy>small{font-size:var(--text-xs);color:var(--muted);margin-top:1px}.agent-row>.workflow-badge,.agent-row>.icon-running{order:1}.agent-row>.icon-right{order:2;color:var(--faint)}
.completed-agents{border-top:1px solid var(--line);padding-top:6px;margin-top:4px!important}
.agent-nav{display:flex;align-items:center;gap:12px;padding-bottom:12px;border-bottom:1px solid var(--line);animation:ultra-push .24s var(--ease)}.ultra-panel .agent-back{flex:none;margin-left:-6px;color:var(--accent);font-weight:500}.ultra-panel .agent-back:hover{color:var(--accent)}.agent-back .icon-right{transform:rotate(180deg)}.agent-nav-context{margin-left:auto;min-width:0;display:flex;flex-direction:column;align-items:flex-end;text-align:right;font-size:var(--text-xs)}.agent-nav-context strong{font-weight:500;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.agent-nav-context .run-counters{font-size:var(--text-xs)}.agent-detail-view{display:flex;flex-direction:column;gap:12px;animation:ultra-push .24s var(--ease)}.agent-detail-header{display:flex;align-items:center;justify-content:space-between;gap:10px}.agent-detail-header h3{margin:0;font-size:16px;line-height:1.3}.agent-activity{color:var(--ink)}
.agent-detail-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md);padding:12px;display:flex;flex-direction:column;gap:6px;align-items:flex-start;font-size:12px}.agent-detail-card>*{align-self:stretch}.agent-detail-card .agent-model{font-weight:500;font-size:var(--text)}
`;

const details = `
.workflow-badge{display:inline-block;flex:none;font-size:var(--text-xs);font-weight:500;white-space:nowrap;border-radius:999px;padding:1px 8px;line-height:1.6}.workflow-badge::first-letter{text-transform:uppercase}
.tone-running{background:var(--info-bg);color:var(--info-ink)}.tone-queued{background:var(--fill);color:var(--muted)}.tone-attention{background:var(--warning-bg);color:var(--warning-ink)}.tone-completed{background:var(--success-bg);color:var(--success-ink)}.tone-failed{background:var(--danger-bg);color:var(--danger-ink)}
.run-disclosure{border-top:1px solid var(--line);padding-top:8px}.run-details{display:flex;flex-direction:column;gap:8px;padding:6px 0 0 18px;font-size:12px}
.workflow-phase{border-top:1px solid var(--line);padding-top:6px}.workflow-phase>summary,.phase-empty{gap:6px 10px}.workflow-phase>summary strong,.phase-empty strong{color:var(--ink);font-weight:500;min-width:0}.workflow-phase>summary .workflow-muted,.phase-empty .workflow-muted{margin-left:auto;white-space:nowrap;font-size:var(--text-xs)}.phase-empty{display:flex;align-items:center;padding:3px 0 3px 18px;font-size:12px}.ultra-panel .phase-tasks{list-style:none;margin:4px 0 2px;padding:0 0 0 18px}.phase-tasks li{display:flex;justify-content:space-between;gap:10px;padding:3px 0}.phase-tasks li>.workflow-muted{display:inline-block}.phase-tasks li>.workflow-muted::first-letter{text-transform:uppercase}.workflow-handoff{margin:8px 0 4px!important;padding:2px 0 2px 12px;border-left:2px solid var(--warning-bg);display:flex;flex-direction:column;gap:6px}.workflow-handoff>*{margin-top:6px}
.workflow-detail,.workflow-task-result{display:flex;flex-direction:column;gap:6px;padding-top:6px}
.workflow-facts{display:grid;grid-template-columns:minmax(80px,38%) minmax(0,1fr);gap:4px 12px;margin:4px 0;font-size:12px}.workflow-facts dt{color:var(--muted)}.workflow-facts dd{margin:0;min-width:0;font-variant-numeric:tabular-nums}.workflow-fact{display:contents}
.workflow-result>.result-facts,.workflow-result>.result-list,.workflow-result>.result-text{margin:6px 0 2px 18px}.result-facts .result-facts{margin:0;padding-left:8px;border-left:1px solid var(--line);grid-template-columns:minmax(64px,40%) minmax(0,1fr)}
.ultra-panel ul{padding-left:16px;margin:4px 0}.result-list{margin:0}.result-list>li+li{margin-top:2px}.result-text{white-space:pre-wrap}.workflow-source{display:block;font:var(--text-xs)/1.4 var(--mono)}
@container(max-width:340px){.workflow-facts{grid-template-columns:1fr;gap:0}.workflow-facts dd{margin-bottom:6px}.dashboard-content{padding:10px}.workflow-run{padding:12px}}
@container(min-width:600px){.dashboard-content{padding:20px 24px}.workflow-run{padding:16px 18px}}
@keyframes ultra-spin{to{transform:rotate(360deg)}}@keyframes ultra-pulse{0%,80%,100%{opacity:.3}40%{opacity:1}}@keyframes ultra-push{from{opacity:0;transform:translateX(16px)}}@keyframes ultra-pop{from{opacity:0;transform:translateX(-16px)}}@keyframes ultra-rise{from{opacity:0;transform:translateY(3px)}}
@media(prefers-reduced-motion:reduce){.ultra-panel *,.ultra-panel *::before{animation:none!important;transition:none!important}}
`;

export const panelStyles = `${theme}:root{--chevron:${cssUrl(chevron)}}${base}${layout}${agents}${details}`;
