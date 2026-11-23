/* Global search grouping (core/search.js).
 *
 * The rule worth pinning: rearranging must not change what Enter opens. The
 * first row stays Frappe's top score. Everything else is grouping and caps.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../themate/public/js/core/search.js"), "utf8"), sandbox);
const arrange = sandbox.window.themate.arrangeSearch;

const results = [];
const check = (name, actual, expected) => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	results.push({ name, actual: a, expected: e, pass: a === e });
};

const row = (value, index, extra) => Object.assign({ value, index }, extra);
const help = row("Help on Search", -10, { default: "Help" });
const typedOptions = [
	row("Search for inv", 100, { default: "Search" }),
	row("Sales Invoice List", 120, { type: "List", route: ["List", "Sales Invoice"] }),
	row("Sales Invoice Report", 119, { type: "Report" }),
	row("New Sales Invoice", 118, { type: "New" }),
	row("Purchase Invoice List", 90, { type: "List" }),
	help,
];

const typed = arrange(typedOptions, "inv");
const values = (list) => list.map((o) => o.value);

check("the top score stays first, so Enter opens the same thing", typed[0].value, "Sales Invoice List");
check("rows are grouped in a fixed order", values(typed), [
	"Sales Invoice List",
	"Purchase Invoice List",
	"Sales Invoice Report",
	"New Sales Invoice",
	"Search for inv",
]);
check("only the first row of a group carries the title", typed.filter((o) => o._tm_title).length, 5);

const noMatch = arrange([row("Search for zz", 100, { default: "Search" }), row("Find zz in Item", 90, { default: "Current" })], "zz");
check("an action is never called the best match", noMatch.map((o) => o._tm_group), ["action", "action"]);
const actionTop = arrange([row("Search for it", 100, { default: "Search" }), row("Item List", 60, { type: "List" })], "it");
check("an action that scores highest stays first", actionTop[0].value, "Search for it");

const twice = arrange([row("Item List", 80, { recent: true }), row("Item List", 3, {})], "");
check("the same page is listed once", values(twice), ["Item List"]);
check("Help is dropped once there is a query", values(typed).includes("Help on Search"), false);
check("original rows are not changed", typedOptions[1]._tm_group, undefined);

const many = Array.from({ length: 20 }, (_, i) => row(`List ${i}`, 50 - i, { type: "List" }));
check("a group is capped, best match plus six", arrange(many, "li").length, 7);

const empty = arrange([row("Item List", 80, { recent: true, route: ["List", "Item"] }), row("Stock", 5, { route: ["stock"] }), help], "");
check("with no query: recent, frequent, then help", empty.map((o) => o._tm_group), ["recent", "frequent", "help"]);

const dash = arrange([
	row("Sales Invoice List", 120, { type: "List" }),
	row("Sales Performance Dashboard", 90, { type: "Dashboard", route: ["dashboard-view", "Sales Performance"] }),
	row("Sales Analytics Report", 80, { type: "Report" }),
], "sales");
check("dashboards are their own group, before reports", dash.map((o) => o._tm_group), ["best", "dashboard", "report"]);
check("the dashboards group is titled", dash[1]._tm_title, "Dashboards");

const tags = [row("#urgent", 1, {})];
check("tag searches pass through untouched", arrange(tags, "#ur") === tags, true);
check("a single row still works", values(arrange([row("Only", 1, { type: "List" })], "on")), ["Only"]);

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
console.log(`\nsearch: ${pass} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
