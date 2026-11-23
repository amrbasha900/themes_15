#!/usr/bin/env node
/* Captures the acceptance matrix on a REAL Frappe site.
 *
 * This cannot run in CI or in a sandbox — it needs a live bench with the theme
 * installed. It exists because the visual half of acceptance is the half that
 * automated contract tests cannot reach: they prove a token resolves, not that
 * a dense Arabic form is legible.
 *
 * Route: List -> Form -> Child Grid -> Dialog
 * Matrix: {English, Arabic} x {Light, Dark} x {1366x768, 1440x900}
 *
 * Usage:
 *   node tests/visual/capture.js \
 *     --url http://site.local:8000 \
 *     --user Administrator --password <pw> \
 *     [--list-doctype ToDo] [--form-doctype User] [--out tests/visual/shots]
 *
 * Output: tests/visual/shots/<lang>-<theme>-<viewport>/NN-<step>.png
 * plus a manifest.json recording the exact versions, routes and settings used,
 * so a later run can be compared against this one rather than against memory.
 */

const fs = require("fs");
const path = require("path");

function arg(name, fallback) {
	const i = process.argv.indexOf(`--${name}`);
	return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SITE = arg("url", "http://site.local:8000").replace(/\/$/, "");
const USER = arg("user", "Administrator");
const PASSWORD = arg("password", process.env.FRAPPE_PASSWORD || "");
const LIST_DT = arg("list-doctype", "ToDo");
/* User is used for the child grid because it ships with Frappe and always has
 * an editable child table (Roles). Override for a populated business doc —
 * e.g. --form-doctype "Sales Invoice" when ERPNext is installed. */
const FORM_DT = arg("form-doctype", "User");
const OUT = path.resolve(arg("out", path.join(__dirname, "shots")));

const VIEWPORTS = [
	{ name: "1366x768", width: 1366, height: 768 },
	{ name: "1440x900", width: 1440, height: 900 },
];
const LANGS = [
	{ code: "en", label: "english", dir: "ltr" },
	{ code: "ar", label: "arabic", dir: "rtl" },
];
const THEMES = ["Light", "Dark"];

function chromiumPath() {
	if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
	const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
	if (base && fs.existsSync(base)) {
		const dir = fs.readdirSync(base).find((d) => /^chromium-\d+$/.test(d));
		if (dir) {
			const p = path.join(base, dir, "chrome-linux", "chrome");
			if (fs.existsSync(p)) return p;
		}
	}
	return undefined;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* themate/www/login.html renders the login fields TWICE — once in Frappe's
 * original macro and once in the themate split-screen block — so #login_email,
 * #login_password and .btn-login each match two elements, and a bare
 * page.fill() fails with a Playwright strict-mode violation. Only one copy is
 * ever visible, so every locator here is filtered to the visible one. */
async function login(page) {
	await page.goto(`${SITE}/login`, { waitUntil: "networkidle" });
	if (page.url().includes("/app")) return; /* already authenticated */

	const visible = (sel) => page.locator(`${sel}:visible`).first();
	const email = visible("#login_email");

	try {
		await email.waitFor({ state: "visible", timeout: 15000 });
	} catch {
		throw new Error(
			`No visible #login_email at ${SITE}/login — is that a Frappe login page? ` +
				`If the login template's selectors changed, update them in this script.`
		);
	}

	await email.fill(USER);
	await visible("#login_password").fill(PASSWORD);

	await Promise.all([
		page.waitForNavigation({ waitUntil: "networkidle" }).catch(() => {}),
		visible(".btn-login").click(),
	]);

	/* Frappe reports a bad password on the same page instead of redirecting. */
	if (page.url().includes("/login")) {
		const msg = await page
			.locator(".msgprint, .alert-danger, #login-error")
			.first()
			.textContent()
			.catch(() => null);
		throw new Error(
			`Login failed — check --user/--password.${msg ? " Site said: " + msg.trim() : ""}`
		);
	}
}

/* Language and theme are per-user server-side settings, so they are set through
 * the API and the page is reloaded, exactly as a real user would experience
 * them. Setting them client-side only would not exercise the boot path. */
async function setUserPrefs(page, { lang, theme }) {
	await page.evaluate(
		async ([l, t]) => {
			await frappe.call("frappe.client.set_value", {
				doctype: "User", name: frappe.session.user,
				fieldname: { language: l, desk_theme: t },
			});
		},
		[lang, theme]
	);
}

async function settle(page, ms = 1200) {
	await page.waitForLoadState("networkidle").catch(() => {});
	await sleep(ms); /* widgets mount async; .btn transitions colour over 100ms */
}

/* Clicks the first match and reports a skip rather than swallowing it.
 * Several of these selectors legitimately match many elements (every list row
 * has a .list-row-checkbox, every grid row a .btn-open-row), which would be a
 * Playwright strict-mode violation on a bare page.click(). A silent catch would
 * leave a screenshot missing with no explanation in the log. */
async function clickFirst(page, selector, label) {
	const loc = page.locator(selector).first();
	try {
		await loc.waitFor({ state: "visible", timeout: 5000 });
		await loc.click({ timeout: 5000 });
		return true;
	} catch {
		console.log(`    (skipped ${label}: no visible ${selector})`);
		return false;
	}
}

async function shoot(page, dir, n, name) {
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `${String(n).padStart(2, "0")}-${name}.png`);
	await page.screenshot({ path: file, fullPage: false });
	console.log("   ", path.relative(process.cwd(), file));
	return file;
}

async function captureRoute(page, dir) {
	const shots = [];

	/* 1. List View, with the filter area open so chips and controls are visible. */
	await page.goto(`${SITE}/app/${LIST_DT.toLowerCase().replace(/ /g, "-")}`, { waitUntil: "networkidle" });
	await settle(page);
	shots.push(await shoot(page, dir, 1, "list"));

	await clickFirst(page, ".filter-selector .filter-button", "open filters");
	await settle(page, 600);
	shots.push(await shoot(page, dir, 2, "list-filters"));
	await page.keyboard.press("Escape").catch(() => {});

	/* Row selection — the state the contract requires to differ from hover. */
	await clickFirst(page, ".list-row-container .list-row-checkbox", "select a row");
	await settle(page, 400);
	shots.push(await shoot(page, dir, 3, "list-row-selected"));

	/* 2. Form. */
	await page.goto(`${SITE}/app/${FORM_DT.toLowerCase().replace(/ /g, "-")}/new`, { waitUntil: "networkidle" });
	await settle(page);
	shots.push(await shoot(page, dir, 4, "form-new"));

	/* An existing document has populated data; an empty form flatters the theme. */
	const first = await page.evaluate(
		async (dt) => (await frappe.db.get_list(dt, { limit: 1 }))?.[0]?.name || null,
		FORM_DT
	);
	if (first) {
		await page.goto(`${SITE}/app/${FORM_DT.toLowerCase().replace(/ /g, "-")}/${encodeURIComponent(first)}`,
			{ waitUntil: "networkidle" });
		await settle(page);
		shots.push(await shoot(page, dir, 5, "form-populated"));

		/* 3. Child grid — scroll it into view and open a row editor. */
		/* Prefer a grid that actually has rows; an empty one shows nothing. */
		const grid =
			(await page.$(".form-grid:has(.grid-row)")) || (await page.$(".form-grid"));
		if (grid) {
			await grid.scrollIntoViewIfNeeded();
			await settle(page, 500);
			shots.push(await shoot(page, dir, 6, "child-grid"));

			await clickFirst(page, ".form-grid .grid-row .btn-open-row", "open a grid row");
			await settle(page, 600);
			shots.push(await shoot(page, dir, 7, "child-grid-row-editor"));
			await page.keyboard.press("Escape").catch(() => {});
		} else {
			console.log("    (no .form-grid on this doctype — pass --form-doctype with a child table)");
		}
	}

	/* 4. Dialog, with an autocomplete open inside it — the layering case the
	 * brief calls out (clipped dropdowns, modal stacking). */
	await page.evaluate(() => {
		const d = new frappe.ui.Dialog({
			title: __("Theme check"),
			fields: [
				{ fieldtype: "Data", fieldname: "subject", label: __("Subject"), reqd: 1 },
				{ fieldtype: "Link", fieldname: "owner", label: __("User"), options: "User" },
				{ fieldtype: "Select", fieldname: "priority", label: __("Priority"), options: "Low\nMedium\nHigh" },
				{ fieldtype: "Date", fieldname: "date", label: __("Date") },
				{ fieldtype: "Currency", fieldname: "amount", label: __("Amount") },
				{ fieldtype: "Small Text", fieldname: "notes", label: __("Notes") },
			],
			primary_action_label: __("Save"),
			primary_action() {},
		});
		d.show();
	});
	await settle(page, 700);
	shots.push(await shoot(page, dir, 8, "dialog"));

	/* Validation state: submit empty so the required field errors. */
	await clickFirst(page, ".modal.show .btn-modal-primary", "submit the dialog");
	await settle(page, 500);
	shots.push(await shoot(page, dir, 9, "dialog-validation"));

	/* Autocomplete inside the modal. */
	await clickFirst(page, '.modal.show [data-fieldname="owner"] input', "focus the autocomplete");
	await settle(page, 800);
	shots.push(await shoot(page, dir, 10, "dialog-autocomplete"));

	await page.keyboard.press("Escape").catch(() => {});
	return shots;
}

/* Playwright downloads a browser binary but NOT the system libraries it links
 * against. On a stock Frappe bench those are usually absent, and the failure
 * arrives as sixty lines of Chromium flags with the real cause — a missing
 * .so — buried in the middle. Translate it into the one command that fixes it.
 *
 * --channel lets a bench with Chrome or Chromium already installed skip the
 * download entirely, which is often the fastest route on a locked-down host. */
async function launchBrowser(chromium) {
	const exe = chromiumPath();
	const channel = arg("channel", null);

	const opts = {};
	if (channel) opts.channel = channel;
	else if (exe) opts.executablePath = exe;

	try {
		return await chromium.launch(opts);
	} catch (e) {
		const msg = String(e && e.message);
		const missing = msg.match(/error while loading shared libraries: ([^:]+)/);

		if (missing) {
			console.error(
				`\nChromium could not start: the system library ${missing[1]} is missing.\n` +
					`Playwright downloads the browser but not its OS dependencies.\n\n` +
					`Fix it with ONE of:\n\n` +
					`  1. sudo npx playwright install-deps chromium\n\n` +
					`  2. sudo apt-get update && sudo apt-get install -y \\\n` +
					`       libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 \\\n` +
					`       libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 libpango-1.0-0 \\\n` +
					`       libcairo2 libasound2t64 libx11-6 libxcb1 libxcomposite1 libxdamage1 \\\n` +
					`       libxext6 libxfixes3 libxkbcommon0 libxrandr2\n` +
					`     (use libasound2 instead of libasound2t64 before Ubuntu 24.04)\n\n` +
					`  3. Use a browser already installed on this host, no root needed:\n` +
					`       npm run capture -- --channel chrome ...\n` +
					`       PLAYWRIGHT_CHROMIUM=/usr/bin/chromium npm run capture -- ...\n`
			);
			process.exit(3);
		}

		if (/Executable doesn't exist|please run.*install/i.test(msg)) {
			console.error(
				`\nNo Chromium binary for Playwright on this host.\n` +
					`  npx playwright install chromium\n` +
					`or point at an existing browser:\n` +
					`  npm run capture -- --channel chrome ...\n`
			);
			process.exit(3);
		}

		throw e;
	}
}

(async () => {
	if (!PASSWORD) {
		console.error("Missing --password (or FRAPPE_PASSWORD). Nothing captured.");
		process.exit(2);
	}

	const { chromium } = require("playwright");
	const browser = await launchBrowser(chromium);
	const manifest = { site: SITE, capturedAt: new Date().toISOString(), listDoctype: LIST_DT, formDoctype: FORM_DT, runs: [] };
	let consoleErrors = [];

	/* The matrix rewrites the user's language and desk theme on the server.
	 * Record what they were so the run leaves the account as it found it —
	 * an Administrator left in Arabic/Dark after a capture is a real surprise. */
	let original = null;
	const rememberPrefs = async (page) => {
		if (original) return;
		original = await page.evaluate(async () => {
			const r = await frappe.db.get_value("User", frappe.session.user, ["language", "desk_theme"]);
			return r.message;
		});
	};

	try {
		for (const vp of VIEWPORTS) {
			for (const lang of LANGS) {
				for (const theme of THEMES) {
					const tag = `${lang.label}-${theme.toLowerCase()}-${vp.name}`;
					console.log(`\n=== ${tag} ===`);
					const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
					const page = await ctx.newPage();

					const errs = [];
					page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
					page.on("pageerror", (e) => errs.push(String(e)));

					await login(page);
					await rememberPrefs(page);
					await setUserPrefs(page, { lang: lang.code, theme });
					await page.reload({ waitUntil: "networkidle" });
					await settle(page);

					const versions = await page.evaluate(() => ({
						frappe: frappe.boot?.versions?.frappe || null,
						apps: Object.keys(frappe.boot?.versions || {}),
						themate: frappe.boot?.themate || null,
						dir: document.documentElement.getAttribute("dir"),
						theme: document.documentElement.getAttribute("data-theme"),
						themeMode: document.documentElement.getAttribute("data-theme-mode"),
					}));

					const dir = path.join(OUT, tag);
					const shots = await captureRoute(page, dir);

					manifest.runs.push({ tag, viewport: vp, lang: lang.code, theme, versions,
						shots: shots.map((f) => path.relative(OUT, f)), consoleErrors: errs });
					consoleErrors = consoleErrors.concat(errs.map((e) => `[${tag}] ${e}`));

					await ctx.close();
				}
			}
		}
	} finally {
		if (original) {
			try {
				const ctx = await browser.newContext();
				const page = await ctx.newPage();
				await login(page);
				await setUserPrefs(page, { lang: original.language || "en", theme: original.desk_theme || "Light" });
				await ctx.close();
				console.log(`\nRestored ${USER}: language=${original.language}, desk_theme=${original.desk_theme}`);
			} catch (e) {
				console.log(`\nCould not restore ${USER}'s language/theme (${e.message}) — set them back by hand.`);
			}
		}
		await browser.close();
	}

	fs.mkdirSync(OUT, { recursive: true });
	fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));

	console.log(`\nCaptured ${manifest.runs.length} runs into ${OUT}`);
	console.log(`Manifest: ${path.join(OUT, "manifest.json")}`);
	if (consoleErrors.length) {
		console.log(`\n${consoleErrors.length} console error(s) recorded — compare against a baseline with the theme disabled:`);
		[...new Set(consoleErrors)].slice(0, 20).forEach((e) => console.log("  " + e));
	} else {
		console.log("\nNo console errors recorded.");
	}
})().catch((e) => { console.error(e); process.exit(1); });
