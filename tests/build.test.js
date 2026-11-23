/* Builds the bundles with FRAPPE'S OWN toolchain, not with dart-sass alone.
 *
 * `sass file.scss out.css` proves the SCSS is valid Sass. It does not prove
 * `bench build --app themate` will succeed, because Frappe compiles through
 * esbuild 0.14 with a legacy-API sass plugin, its own sassOptions, its
 * ignore-assets resolver, and then postcss + autoprefixer. A stylesheet can be
 * perfectly valid Sass and still fail there.
 *
 * That difference is not hypothetical: a bench reported all three asset files
 * MISSING while dart-sass compiled the same sources cleanly. This suite closes
 * the gap between "it compiles" and "it ships".
 *
 * Versions mirror frappe/package.json (v15): esbuild ^0.14.29, sass ^1.63.0,
 * postcss 8, autoprefixer 10.
 */

const path = require("path");

const APP = path.resolve(__dirname, "../themate/public");
const APP_ROOT = path.resolve(__dirname, "..");

/* Copied from frappe/esbuild/sass_options.js — the legacy `importer` returning
 * {file} is what selects Sass's legacy API, so this is not an approximation. */
const sass_options = {
	includePaths: [APP_ROOT],
	quietDeps: true,
	importer: function (url) {
		if (url.startsWith("~")) url = url.slice(1);
		if (url.endsWith(".css")) url = url.slice(0, -4);
		return { file: url };
	},
};

/* Copied from frappe/esbuild/ignore-assets.js — /assets/... URLs are served at
 * runtime, so they must not be resolved at build time. Without this every
 * @font-face src fails and the whole bundle errors out. */
const ignore_assets = {
	name: "frappe-ignore-asset",
	setup(build) {
		build.onResolve({ filter: /^\/assets\// }, (args) => ({ path: args.path, external: true }));
	},
};

const results = [];
const check = (name, actual, expected) => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	results.push({ name, actual: a, expected: e, pass: a === e });
};

(async () => {
	let esbuild, sassPlugin, postcss, autoprefixer;
	try {
		esbuild = require("esbuild");
		({ sassPlugin } = require("esbuild-sass-plugin"));
		postcss = require("postcss");
		autoprefixer = require("autoprefixer");
	} catch (e) {
		console.log("  skip  Frappe build toolchain not installed (npm install inside tests/)");
		console.log("        " + e.message.split("\n")[0]);
		process.exit(0);
	}

	const targets = [
		{ name: "themate.bundle.css", entry: path.join(APP, "scss/themate.bundle.scss"), css: true },
		{ name: "themate-login.bundle.css", entry: path.join(APP, "scss/themate-login.bundle.scss"), css: true },
		{ name: "themate.bundle.js", entry: path.join(APP, "js/themate.bundle.js"), css: false },
	];

	for (const t of targets) {
		let out = null;
		try {
			const result = await esbuild.build({
				entryPoints: [t.entry],
				bundle: true,
				write: false,
				outfile: "/tmp/themate-build-test-" + t.name,
				plugins: t.css
					? [ignore_assets, sassPlugin({ type: "css", sassOptions: sass_options })]
					: [ignore_assets],
				loader: { ".woff2": "file", ".ttf": "file", ".png": "file", ".svg": "file" },
				logLevel: "silent",
			});
			out = result.outputFiles.map((f) => f.text).join("");
			check(`${t.name}: builds under esbuild 0.14`, true, true);
		} catch (e) {
			check(`${t.name}: builds under esbuild 0.14`, String(e.message).split("\n").slice(0, 4).join(" | "), true);
			continue;
		}

		check(`${t.name}: output is not empty`, out.length > 5000, true);

		if (t.css) {
			try {
				const processed = await postcss([autoprefixer]).process(out, { from: undefined });
				check(`${t.name}: survives postcss + autoprefixer`, true, true);
				out = processed.css;
			} catch (e) {
				check(`${t.name}: survives postcss + autoprefixer`, String(e.message), true);
				continue;
			}
		}

		if (t.name === "themate.bundle.css") {
			/* Modern selectors and logical properties must reach the browser
			 * intact — esbuild 0.14 predates some of them and could in principle
			 * drop or mangle what it does not recognise. */
			check("guard selector survives the pipeline", out.includes("html:not([data-tm-enabled"), true);
			check(":has() selection survives", out.includes(":has(.list-row-checkbox:checked)"), true);
			check("logical properties survive", out.includes("padding-inline"), true);
			check("the accent reaches the bridge", out.includes("--btn-primary"), true);
			check("dark tokens are present", out.includes('[data-theme="dark"]') || out.includes("[data-theme=dark]"), true);
		}

		if (t.name === "themate.bundle.js") {
			/* The bundle must actually carry every module, not silently drop one. */
			check("bundle includes the palette generator", out.includes("generateDark"), true);
			check("bundle includes the theme bootstrap", out.includes("data-theme-mode"), true);
			check("bundle includes the accent picker", out.includes("tm-accent"), true);
		}
	}

	let pass = 0;
	const failures = [];
	for (const r of results) {
		if (r.pass) { pass++; console.log(`  ok   ${r.name}`); }
		else { failures.push(r); console.log(`  FAIL ${r.name}\n         expected ${r.expected}\n         got      ${r.actual}`); }
	}
	console.log(`\nfrappe build: ${pass} passed, ${failures.length} failed`);
	process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
