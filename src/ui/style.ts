// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/** Stylesheet of the local UI, served from /static/app.css (CSP style-src 'self'). No external fonts or images. */
export const APP_CSS = `:root{color-scheme:light;--ink:#14181d;--muted:#5b6570;--line:#dfe3e8;--soft:#f5f7f9;--bg:#ffffff;--accent:#0b5cad;--accent-ink:#ffffff;--bad:#a8261b;--bad-soft:#fdf0ee;--ok:#1f6f3f;--ok-soft:#edf7f0;--warn:#8a5a00;--warn-soft:#fdf6e7}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
a{color:var(--accent)}
header.top{border-bottom:1px solid var(--line);background:var(--bg)}
header.top .bar{max-width:1080px;margin:0 auto;padding:12px 16px;display:flex;flex-wrap:wrap;align-items:center;gap:8px 20px}
.brand{font-weight:700;font-size:1.05rem;color:var(--ink);text-decoration:none;margin-right:auto}
nav a{color:var(--ink);text-decoration:none;padding:4px 0;border-bottom:2px solid transparent}
nav a:hover{border-bottom-color:var(--line)}
nav{display:flex;flex-wrap:wrap;gap:4px 18px;align-items:center}
nav form{margin:0}
main{max-width:1080px;margin:0 auto;padding:28px 16px 40px}
h1{font-size:1.5rem;line-height:1.25;margin:0 0 6px}
h2{font-size:1.1rem;margin:32px 0 10px}
h3{font-size:1rem;margin:0 0 8px}
p{margin:0 0 12px}
.lead{color:var(--muted);margin-bottom:20px}
.muted{color:var(--muted)}
table{border-collapse:collapse;width:100%;font-size:.94rem}
.scroll{overflow-x:auto;margin:0 0 16px}
th,td{border-bottom:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
th{font-weight:600;color:var(--muted);font-size:.85rem}
td{overflow-wrap:break-word}
.nw{white-space:nowrap}
dl{display:grid;grid-template-columns:minmax(120px,max-content) 1fr;gap:4px 18px;margin:0 0 16px}
dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}
.status{display:inline-block;white-space:nowrap;font-size:.8rem;font-weight:600;padding:1px 8px;border-radius:999px;background:var(--soft);color:var(--muted)}
.status.done,.status.passed{background:var(--ok-soft);color:var(--ok)}
.status.late,.status.overdue,.status.conflict{background:var(--bad-soft);color:var(--bad)}
.status.due,.status.review,.status.missing{background:var(--warn-soft);color:var(--warn)}
.flash{padding:10px 14px;border-radius:6px;margin:0 0 18px}
.flash.ok{background:var(--ok-soft);color:var(--ok)}
.flash.bad{background:var(--bad-soft);color:var(--bad)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}
.panel{border:1px solid var(--line);border-radius:8px;padding:16px}
form.stack{display:flex;flex-direction:column;gap:10px}
input[type=text],input[type=email],textarea{width:100%;font:inherit;padding:8px 10px;border:1px solid #c4cad1;border-radius:6px;background:#fff;color:var(--ink)}
textarea{min-height:84px;resize:vertical}
input:focus-visible,textarea:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
fieldset{border:0;padding:0;margin:0 0 8px}
legend{font-weight:600;margin-bottom:6px;padding:0}
.choices{display:flex;flex-wrap:wrap;gap:6px 18px}
.choices label{display:flex;gap:6px;align-items:center}
.checks{display:flex;flex-direction:column;gap:4px}
.checks label{display:flex;gap:8px;align-items:flex-start}
button{font:inherit;font-weight:600;padding:8px 16px;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:var(--accent-ink);cursor:pointer;align-self:flex-start;white-space:nowrap}
button.quiet{background:transparent;color:var(--accent)}
button.link{border:0;background:none;color:var(--ink);padding:4px 0;font-weight:400}
.docs li{margin:0 0 6px}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media (max-width:640px){dl{grid-template-columns:minmax(0,1fr);gap:0}dd{margin-bottom:8px}table.rows thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}table.rows tr{display:block;padding:10px 0;border-bottom:1px solid var(--line)}table.rows td{display:grid;grid-template-columns:96px minmax(0,1fr);overflow-wrap:anywhere;gap:10px;border:0;padding:3px 0;white-space:normal}table.rows td::before{content:attr(data-label);color:var(--muted);font-size:.85rem;white-space:normal}table.rows td>.status{justify-self:start}}
footer.bottom{border-top:1px solid var(--line);color:var(--muted);font-size:.85rem}
footer.bottom .bar{max-width:1080px;margin:0 auto;padding:16px;display:flex;flex-wrap:wrap;gap:6px 20px;justify-content:space-between}
`;
