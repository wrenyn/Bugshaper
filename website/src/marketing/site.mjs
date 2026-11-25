import { readFileSync, readdirSync } from "node:fs";
import { pricing, security } from "./marketing.mjs";

const header = `<a class="skip-link button" href="#main">Skip to content</a><header class="site-header"><nav class="shell nav" aria-label="Main navigation">
<a class="brand" href="/"><img src="/brand/mark.svg" alt="" width="28" height="28">bugshaper</a>
<div class="nav-links"><a href="/features">Product</a><a href="/#demo">How it works</a><a href="/docs">Docs</a><a href="/pricing">Pricing</a><a class="mobile-entry" href="/login">Log in</a></div>
<div class="nav-actions"><a class="nav-login" href="/login">Log in</a><a class="button nav-cta" href="/login">Get started</a></div></nav></header>`;
const footer = `<footer class="site-footer"><div class="shell footer">
<div class="footer-brand"><a class="brand" href="/"><img src="/brand/mark.svg" alt="" width="32" height="32">bugshaper</a><p>A Wrenyn product</p></div>
<nav class="footer-nav" aria-label="Footer">
<div><p class="footer-label">Product</p><a href="/features">Overview</a><a href="/docs">Docs</a><a href="/pricing">Pricing</a><a href="/changelog">Changelog</a></div>
<div><p class="footer-label">Company</p><a href="/security">Security</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/docs#feedback">Contact</a></div>
</nav>
</div></footer>`;

function page(title, description, content, demo = false, origin = "https://bugshaper.xyz") {
  const ogImage = origin.replace(/\/$/, "") + "/brand/social.png";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Bugshaper</title><meta name="description" content="${description}"><meta property="og:title" content="${title} · Bugshaper"><meta property="og:description" content="${description}"><meta property="og:image" content="${ogImage}"><link rel="icon" href="/brand/mark.svg" type="image/svg+xml"><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/site.css">${demo ? '<script type="module" src="/demo.js"></script>' : ""}</head><body>${header}<main id="main" tabindex="-1">${content}</main>${footer}</body></html>`;
}

const home = `<section class="hero">
  <div class="hero-sky" aria-hidden="true"></div>
  <div class="shell hero-copy">
    <p class="hero-brand">bugshaper</p>
    <h1>Evidence that ends the argument.</h1>
    <p class="lede">Capture what broke. Share one report. Fix it together.</p>
    <div class="actions"><a class="button" href="/login">Create free workspace</a><a class="text-link" href="#demo">Try the demo</a></div>
  </div>
  <div class="hero-stage" aria-label="Product preview">
    <div class="product-frame">
      <div class="product-rail" aria-hidden="true">
        <span class="rail-brand">bugshaper</span>
        <span class="rail-item active">Reports</span>
        <span class="rail-item">Projects</span>
        <span class="rail-item">Activity</span>
        <span class="rail-item">Members</span>
      </div>
      <div class="product-main">
        <div class="product-toolbar"><span>Acme Checkout</span><span>Open · High</span></div>
        <div class="preview"><div class="window-bar"><span><i></i> Investigation</span><span>Example report</span></div><div class="preview-body"><div><p class="eyebrow">BUG-1024 <span class="sample-status">Open</span></p><h2>Checkout button&nbsp;overflows on&nbsp;mobile</h2><div class="mock-browser"><div><span></span><span></span><span></span><code>shop.example / checkout</code></div><div class="mock-order"><strong>Order summary</strong><p>Everyday tote <b>₹1,499</b></p><div class="selection">Place order <span aria-hidden="true">↗</span></div></div></div></div>
<div class="preview-side"><h3>Selected element</h3><code>button.checkout</code><dl><dt>Viewport</dt><dd>375 × 812</dd><dt>Min width</dt><dd>420px</dt><dt>Overflow</dt><dd>61px</dd></dl><span class="signal">Layout overflow</span></div></div><ol class="preview-events"><li><time>00:01</time> Click</li><li><time>00:02</time> <span class="failed">500</span> Checkout request</li><li><time>00:02</time> TypeError</li></ol></div>
      </div>
    </div>
  </div>
</section>
<section class="band" id="demo"><div class="shell section demo-lab">
  <div class="demo-lab-intro">
    <p class="eyebrow">How it works</p>
    <h2>Click the failure. See the proof.</h2>
  </div>
  <div class="probe">
    <div class="probe-copy">
      <div class="timeline" aria-label="Sample timeline">
        <button type="button" data-event="click" aria-pressed="true"><time>00:01.200</time><span>Checkout clicked</span></button>
        <button type="button" data-event="network" aria-pressed="false"><time>00:01.760</time><span>Request failed</span></button>
        <button type="button" data-event="error" aria-pressed="false"><time>00:01.772</time><span>Exception</span></button>
        <button type="button" data-event="layout" aria-pressed="false"><time>00:02.014</time><span>Layout shift</span></button>
      </div>
    </div>
    <div class="probe-panel" aria-live="polite">
      <p class="eyebrow">Evidence</p>
      <h3 id="event-title">Checkout clicked</h3>
      <pre id="event-evidence">Click → button.checkout
Viewport: 375 × 812</pre>
      <p id="event-note">The interaction marks the start of the investigation.</p>
    </div>
  </div>
  <div class="probe inspect-lab" id="inspect">
    <div class="probe-copy">
      <div class="inspect-stage">
        <div class="inspect-stage-bar"><span>shop.example/checkout</span><span>375 × 812</span></div>
        <div class="inspect-page">
          <button type="button" data-element="summary" aria-pressed="false"><span>Order summary</span><strong>₹1,499</strong></button>
          <button type="button" data-element="address" aria-pressed="false">Delivery address</button>
          <button type="button" data-element="button" aria-pressed="true">Place order <span aria-hidden="true">→</span></button>
        </div>
      </div>
    </div>
    <div class="probe-panel" aria-live="polite">
      <p class="eyebrow">Selected element</p>
      <h3 id="element-title">button.checkout</h3>
      <pre id="element-evidence">main › form › button.checkout
Bounds: x 16 · y 354 · 420 × 48
Parent: form · 343px wide
Viewport: 375 × 812
display: flex
min-width: 420px</pre>
      <p id="element-note">The button extends 61px past the viewport's right edge.</p>
    </div>
  </div>
</div></section>
<section class="closing"><div class="shell"><h2>Stop explaining bugs.<br><span>Start fixing them.</span></h2><div class="actions"><a class="button" href="/login">Get started free</a><a class="text-link" href="/docs">Docs</a></div></div></section>`;

const pages = {
  "/": ["Capture and investigate web bugs", "Capture browser evidence and investigate software bugs with Bugshaper.", home],
  "/features": ["Product", "Explore Bugshaper capture and investigation features.", `<h1>Capture. Investigate. Resolve.</h1><p class="lede">Collect browser evidence and give each issue a report developers can work from.</p><h2>Capture</h2><p>Take a viewport screenshot, record a tab, capture recent activity, or inspect a specific element.</p><h2>Investigate</h2><p>Review the timeline, sanitized console and request signals, layout replay, and computed CSS. Compare screenshots and log verification results.</p><h2>Share</h2><p>Export a metadata bundle or create an expiring viewer token after importing the report into the local API.</p><a class="button" href="/#demo">Explore the demo</a>`],
  "/docs": ["Documentation", "Install Bugshaper and connect the CLI and MCP server.", `<h1>Documentation</h1><h2 id="install">Install the development build</h2><ol><li>Obtain the Bugshaper source and use desktop Chrome 116 or later.</li><li>Open <code>chrome://extensions</code> and enable Developer mode.</li><li>Choose Load unpacked and select the <code>extension</code> directory.</li><li>Open an HTTP or HTTPS page and launch Bugshaper from Chrome's extension menu.</li></ol><h2>Capture a report</h2><p>Start diagnostics before triggering an issue to collect recent activity. Capture a screenshot or select an element. The extension opens the saved report in a new tab. Use the recording action for up to 60 seconds of tab video.</p><h2 id="cli">Run the local API and CLI</h2><p>Use Node.js 22.13 or later. For a hosted Google workspace, sign in through the browser—the extension and dashboard use your HttpOnly session cookie on the same origin. Set <code>BUGSHAPER_API_URL</code> to your workspace origin when running scripts or agents against that deployment.</p><p>For the legacy single-user API, set <code>BUGSHAPER_OWNER_KEY</code> to a random secret of at least 32 characters and configure <code>BUGSHAPER_API_TOKEN</code> with that owner or agent key.</p><pre>node backend/start.mjs
node cli/cli.mjs import report.json
node cli/cli.mjs list</pre><h2 id="mcp">Connect an MCP client</h2><p>On a hosted workspace, authenticate with the same session or token your operator allows for API access. For local legacy mode, set a distinct <code>BUGSHAPER_AGENT_KEY</code> and pass it as <code>BUGSHAPER_API_TOKEN</code>. Configure the command as <code>node</code> and the argument as the absolute path to <code>cli/mcp.mjs</code>. Start the API before connecting.</p><h2 id="feedback">Contact and feedback</h2><p>For help with a development build, use the contact channel through which you received the source.</p>`],
  "/pricing": ["Pricing", "Availability and pricing for the Bugshaper development build.", `<h1>Pricing</h1><p class="lede">The current development build runs locally. Public plans and pricing have yet to be announced.</p><a class="button" href="/docs#install">Install the development build</a>`],
  "/changelog": ["Changelog", "Review capabilities in the current Bugshaper development build.", `<h1>Changelog</h1><h2>0.2 development build</h2><ul><li>Viewport capture, tab recording, and element inspection.</li><li>Local report editor, diagnostic timeline, and layout replay.</li><li>Metadata bundles, token-based viewer, CLI, and read-only MCP.</li></ul>`],
  "/privacy": ["Privacy", "How Bugshaper handles identity, captures, and workspace data.", `<h1>Privacy</h1><p class="template-notice" role="note"><strong>Template notice.</strong> This page is a starting template. Replace it with your operator-approved privacy notice before go-live.</p><h2>Who operates this instance</h2><p>The organization that deploys Bugshaper is the data controller for accounts and workspace content on that deployment. Update this notice with your legal entity, contact email, and retention periods before production use.</p><h2>Identity</h2><p>Google sign-in provides a verified email and display name. Session cookies are HttpOnly and expire. The operator may also enable invitation email delivery through Resend when configured.</p><h2>Browser capture</h2><p>Diagnostics are opt-in. Exports omit form values, request bodies, headers, and raw exception messages. Screenshots and video can still show anything visible in the tab. The extension stores local drafts in the Chrome profile until you upload or delete them.</p><h2>Workspace storage</h2><p>Imported reports, comments, membership, activity, and selected media are stored by the service operator and visible to authorized workspace members. Payment card details are handled by Dodo Payments when billing is enabled.</p><h2>Deletion and support</h2><p>Workspace members can delete reports they are allowed to manage. For account deletion or retention questions, contact the operator who hosts this service.</p>`],
  "/terms": ["Terms", "Service terms for Bugshaper workspaces.", `<h1>Terms</h1><p class="template-notice" role="note"><strong>Template notice.</strong> This page is a starting template. Replace it with your counsel-approved terms before go-live.</p><p class="lede">Bugshaper is operated by the organization that hosts this instance. Replace this page with your counsel-approved terms before accepting paying customers.</p><h2>Operator responsibilities</h2><p>The service operator controls hosting, backups, retention, support contact, and provider accounts (Google, payments, email). Users must not upload unlawful content or attempt to bypass workspace access controls.</p><h2>Accounts and workspaces</h2><p>Access requires a verified Google identity (or the operator’s configured demo mode in non-production). Workspace owners are responsible for invitations and billing choices.</p><h2>Captures and evidence</h2><p>Browser captures may include visible page content. Review and redact before sharing. The operator stores imported reports and attachments according to their retention policy.</p><a href="/privacy">Privacy notice</a>`],
  "/login": ["Open Bugshaper", "Open the reports dashboard or a shared Bugshaper report.", `<h1>Open Bugshaper</h1><p class="lede">Use your workspace access token to browse reports, or open a single report with its share token.</p><div class="actions"><a class="button" href="/dashboard">Open reports dashboard</a> <a href="/viewer">Open shared report</a></div>`],
};

export function publicAssets({ origin = process.env.BUGSHAPER_ORIGIN || "https://bugshaper.xyz" } = {}) {
  const assets = new Map();
  function add(route, type, filename) {
    assets.set(route, { type, body: readFileSync(new URL(filename, import.meta.url)) });
  }
  const productPages = { ...pages,
    "/": ["Bug reports, shaped for teamwork", "Capture browser evidence, collaborate with your team, and resolve bugs with Bugshaper.", home],
    "/pricing": ["Simple pricing for your team", "Free, Pro, and Business workspace plans for Bugshaper teams.", pricing],
    "/security": ["Security and access", "How Bugshaper scopes workspace access and protects browser evidence.", security],
    "/features": ["A complete bug workspace", "Capture evidence, collaborate with your team, and track bugs to resolution.", pages["/features"][2]],
    "/docs": ["Documentation", pages["/docs"][1], pages["/docs"][2] + '<h2 id="workspace">Work with your team</h2><ol><li>Sign in with Google to create your first workspace.</li><li>In Projects, create a home for your product reports.</li><li>In Members, invite your teammates and set their access.</li><li>Create a report, or import an exported browser capture from Reports.</li><li>Assign an owner, discuss the evidence, and move the status forward.</li></ol><h2 id="production">Set up the service</h2><p>For a local walkthrough, run <code>npm run dev</code> and choose Explore the demo workspace on the login page. The demo is restricted to development. Service operators should follow <code>DEPLOYMENT.md</code> to configure Google sign-in, Dodo Payments, email, HTTPS, and persistent storage.</p>'],
    "/privacy": ["Privacy", pages["/privacy"][1], pages["/privacy"][2] + '<h2>Team workspaces and identity</h2><p>Google sign-in supplies your verified email and display name. Imported reports, selected media, comments, workspace membership, invitations, and activity are stored by the service operator and are accessible to authorized workspace members. The operator is responsible for retention, deletion requests, and backups.</p><h2>Service providers</h2><p>Google handles authentication. Dodo Payments handles checkout and payment details. If configured, Resend receives invitation email addresses and invitation content for delivery. Bugshaper stores subscription references and status, not payment card details.</p>'],
    "/changelog": ["Changelog", "What's new in Bugshaper.", '<h1>Changelog</h1><h2>0.3 · The team workspace</h2><ul><li>Google sign-in and independent workspaces.</li><li>Projects, teams, role-based access, and email-bound invitations.</li><li>Report assignments, discussions, diagnostics, and imports.</li><li>Workspace overview, analytics, activity, and notifications.</li><li>Free, Pro, and Business plans with Dodo Payments checkout and portal.</li></ul>' + pages["/changelog"][2].replace('<h1>Changelog</h1>', '')],
  };
  for (const [route, [title, description, content]] of Object.entries(productPages)) {
    assets.set(route, { type: "text/html; charset=utf-8", body: page(title, description,
      route === "/" ? content : `<article class="shell document">${content}</article>`, route === "/", origin).replace("</head>", '<link rel="stylesheet" href="/marketing.css"></head>') });
  }
  add("/site.css", "text/css; charset=utf-8", "../../public/site.css");
  add("/marketing.css", "text/css; charset=utf-8", "./marketing.css");
  add("/theme.css", "text/css; charset=utf-8", "../../public/theme.css");
  add("/demo.js", "text/javascript; charset=utf-8", "./demo.js");
  for (const file of readdirSync(new URL("../../public/brand/", import.meta.url))) {
    const type = { svg: "image/svg+xml", png: "image/png", woff2: "font/woff2" }[file.split(".").at(-1)];
    if (type) add("/brand/" + file, type, "../../public/brand/" + file);
  }
  return assets;
}
