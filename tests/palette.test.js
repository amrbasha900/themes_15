/* Pins the runtime ramp generator to the frozen SCSS palettes.
 *
 * The bug this guards: core/bootstrap.js used to build brand ramps by mixing
 * linearly toward white and black. That produced a different ramp from the one
 * in tokens/_palette.scss (#4995ff where the contract says #4096ff), and had no
 * dark variant at all, so a runtime brand colour silently repainted dark mode
 * with light-mode colours.
 *
 * Reading the expected values OUT OF THE SCSS means the two cannot drift: edit
 * a stop in either place without the other and this fails.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");

function loadPalette() {
	const src = fs.readFileSync(path.join(ROOT, "themate/public/js/core/palette.js"), "utf8");
	const sandbox = { window: {} };
	vm.createContext(sandbox);
	vm.runInContext(src, sandbox);
	return sandbox.window.themate.palette;
}

/* Pull --tm-brand-NNN out of a SCSS file, scoped to a selector block. */
function readRamp(file, selector) {
	const src = fs.readFileSync(path.join(ROOT, file), "utf8");
	const start = src.indexOf(selector);
	if (start === -1) throw new Error(`selector ${selector} not found in ${file}`);
	/* Search past the selector text: these selectors contain Sass interpolation,
	 * so the first "{" inside them belongs to "#{", not to the rule block. */
	const open = src.indexOf("{", start + selector.length);
	let depth = 0;
	let end = open;
	for (let i = open; i < src.length; i++) {
		if (src[i] === "{") depth++;
		else if (src[i] === "}") {
			depth--;
			if (depth === 0) {
				end = i;
				break;
			}
		}
	}
	const block = src.slice(open, end);
	const ramp = {};
	for (const m of block.matchAll(/--tm-brand-(\d+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
		ramp[m[1]] = m[2].toLowerCase();
	}
	return ramp;
}

const results = [];
const check = (name, actual, expected) => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	results.push({ name, actual: a, expected: e, pass: a === e });
};

const palette = loadPalette();
const DEFAULT_BRAND = "#1677ff";

/* Both files are now scoped by the master rollback guard
 * (tokens/_guard.scss), so the block opens with the interpolated selector. */
const scssLight = readRamp("themate/public/scss/tokens/_palette.scss", "#{$tm-on}");
const scssDark = readRamp("themate/public/scss/tokens/_dark.scss", '#{$tm-on}[data-theme="dark"]');

const genLight = palette.generate(DEFAULT_BRAND);
const genDark = palette.generateDark(DEFAULT_BRAND, palette.DARK_SURFACE);

check(
	"light ramp: generator reproduces tokens/_palette.scss exactly",
	palette.STEPS.map((s, i) => genLight[i]),
	palette.STEPS.map((s) => scssLight[String(s)])
);

check(
	"dark ramp: generator reproduces tokens/_dark.scss exactly",
	palette.STEPS.map((s, i) => genDark[i]),
	palette.STEPS.map((s) => scssDark[String(s)])
);

/* The contract names these three explicitly (DESIGN_CONTRACT.md §3). */
check("contract: base accent is #1677ff", genLight[5], "#1677ff");
check("contract: hover step is #4096ff", genLight[4], "#4096ff");
check("contract: pressed step is #0958d9", genLight[6], "#0958d9");
check("contract: selected background is #e6f4ff", genLight[0], "#e6f4ff");

/* Shape guarantees that must hold for any brand, not just the default. */
for (const brand of ["#722ed1", "#52c41a", "#f5222d", "#13c2c2"]) {
	const ramp = palette.generate(brand);
	check(`ramp(${brand}): the chosen colour lands on step 500`, ramp[5], brand);
	check(`ramp(${brand}): produces all 10 stops`, ramp.length, 10);
	const dark = palette.generateDark(brand, palette.DARK_SURFACE);
	check(`ramp(${brand}): dark variant differs from light`, dark[5] !== ramp[5], true);
	check(
		`ramp(${brand}): dark step 50 is near the dark surface, not a light tint`,
		parseInt(dark[0].slice(1, 3), 16) < 0x60,
		true
	);
}

/* Degenerate inputs must not throw or emit garbage. */
check("invalid colour returns null rather than a broken ramp", palette.generate("not-a-colour"), null);
check("shorthand hex is accepted", palette.generate("#07f")?.length, 10);
check("pure grey stays grey (no hue invented)", palette.generate("#808080")?.length, 10);

let pass = 0;
const failures = [];
for (const r of results) {
	if (r.pass) {
		pass++;
		console.log(`  ok   ${r.name}`);
	} else {
		failures.push(r);
		console.log(`  FAIL ${r.name}\n         expected ${r.expected}\n         got      ${r.actual}`);
	}
}
console.log(`\npalette: ${pass} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
