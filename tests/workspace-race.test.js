/* Two workspace loads that overlap (a second click on a slow server).
 *
 * Frappe's show_page keeps page / content / data on the instance, so the
 * slower answer used to land on the newer page: blocks drawn from another
 * workspace's data, most of the page missing until a reload. tabs.js fetches
 * the data itself and lets only the latest call through. Run on a mock of
 * Frappe's shapes; get_data answers with a jQuery-style promise (no
 * .finally), which is what Frappe really returns. */
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const src = fs.readFileSync(path.join(__dirname, "../themate/public/js/workspace/tabs.js"), "utf8");

const answers = {}; /* workspace -> resolve its data request */
const drawn = [];
class Workspace {
	constructor() {
		this.pages = {};
		this.public_pages = [{ title: "A", name: "A" }, { title: "B", name: "B" }];
		this.private_pages = [];
	}
	create_page_skeleton() {}
	make_sidebar() {}
	get_data(page) {
		const p = new Promise((resolve) => { answers[page.name] = resolve; }).then(() => {
			this.page_data = `data of ${page.name}`;
			this.pages[page.name] = this.page_data;
		});
		return { then: p.then.bind(p) }; /* thenable only, as jQuery's */
	}
	async show_page(page) {
		this.page_data = this.pages[page.name];
		drawn.push(`${page.name} with ${this.page_data}`);
	}
}

const $ = (x) => ({ on() {} , ready() {} });
const frappe = {
	views: { Workspace },
	router: { on() {} },
	get_route: () => ["List"],
	utils: { get_url_arg: () => null },
};
const window = { frappe, jQuery: $, themate: { enabled: () => true } };
new Function("window", "document", "setTimeout", "clearTimeout", src)(window, {}, () => 0, () => {});

(async () => {
	const ws = new Workspace();
	ws.show_page({ name: "A", public: true });
	ws.show_page({ name: "B", public: true }); /* clicked before A answered */
	answers.B();
	await new Promise((r) => setImmediate(r));
	answers.A(); /* the slow one lands last */
	await new Promise((r) => setImmediate(r));

	assert.deepStrictEqual(drawn, ["B with data of B"], "only the latest workspace is drawn, from its own data");
	assert.strictEqual(ws.page_data, "data of B", "the late answer does not replace the data on screen");
	assert.strictEqual(ws.pages.A, "data of A", "the late answer is still kept for the next visit");

	await ws.show_page({ name: "A", public: true }); /* cached now: no request, drawn at once */
	assert.strictEqual(drawn[1], "A with data of A");
	console.log("workspace-race: ok");
})().catch((e) => { console.error(e); process.exit(1); });
