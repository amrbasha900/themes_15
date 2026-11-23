/* Workspace blocks — a registry for editor.js block types other apps add
 * to workspaces (InnoDash's Business Overview card, for one).
 *
 * Native: frappe/public/js/frappe/views/workspace/workspace.js builds the
 * editor's tool list by hand (initialize_editorjs) and keeps the EditorJS
 * class as a module import, so an app cannot simply register one more
 * tool. What this file does instead:
 *
 *  1. window.themate.registerWorkspaceBlock(type, cls) — call it at load,
 *     before any workspace renders;
 *  2. wraps initialize_editorjs: lets Frappe build `this.tools` and its
 *     editor into a hidden throwaway holder, takes the EditorJS class from
 *     that instance, destroys it, and creates the real editor in the real
 *     holder with the same tools plus every registered one. One extra empty
 *     editor per page load, never a second render of the blocks.
 *
 * Content stays plain workspace JSON — save_page stores unknown block types
 * untouched (desk/desktop.py clean_up only prunes the known ones), and a
 * site without the app that owns a block simply skips it. */
(function () {
	const frappe = window.frappe;
	const Workspace = frappe?.views?.Workspace;
	if (!Workspace || Workspace.prototype._tm_blocks) return;

	window.themate = window.themate || {};
	const registry = (window.themate.workspaceBlocks = window.themate.workspaceBlocks || {});
	window.themate.registerWorkspaceBlock = (type, cls) => {
		registry[type] = cls;
		if (frappe.workspace_block?.blocks) frappe.workspace_block.blocks[type] = cls;
	};

	/* ---- the editor: same tools + the registered ones ---------------------
	 * EditorJS resolves a string `holder` twice: synchronously in validate()
	 * (must exist) and again, a tick later, when the UI mounts. So the real
	 * holder keeps its temporary id until the throwaway has mounted into
	 * the temp one; the real editor is given the element itself. */
	let EditorJS = null;
	const original = Workspace.prototype.initialize_editorjs;
	Workspace.prototype.initialize_editorjs = function (content) {
		if (!Object.keys(registry).length) return original.apply(this, arguments);
		const real = document.getElementById("editorjs");
		const temp = document.createElement("div");
		temp.id = "editorjs";
		temp.hidden = true;
		if (real) real.id = "tm-editorjs-real";
		document.body.appendChild(temp);
		const restore = () => {
			if (real) real.id = "editorjs";
			temp.remove();
		};
		let throwaway;
		try {
			original.call(this, []); /* builds this.tools; mounts into the temp holder */
			throwaway = this.editor;
			EditorJS = EditorJS || throwaway?.constructor;
		} catch (e) {
			restore();
			throw e;
		}
		if (!EditorJS || !real) {
			restore();
			return; /* the throwaway IS the editor; nothing we can do */
		}
		throwaway.isReady
			.then(() => throwaway.destroy())
			.catch(() => {})
			.then(restore, restore);

		Object.entries(registry).forEach(([type, cls]) => {
			this.tools[type] = { class: cls, config: { page_data: this.page_data || [] } };
		});
		this.editor = new EditorJS({
			holder: real,
			data: { blocks: content || [] },
			tools: this.tools,
			autofocus: false,
			readOnly: true,
			logLevel: "ERROR",
		});
	};
	/* Frappe drops its block skeleton straight after starting the editor
	 * (workspace.js:453 show_page -> prepare_editorjs -> remove_page_skeleton),
	 * before editor.js has drawn a single block — and the throwaway editor
	 * above stretches that to half a second: a skeleton, then an empty page,
	 * then the blocks. The skeleton now stays until the editor is ready (its
	 * isReady resolves after the first render), never longer than a
	 * backstop. An editor that is already ready changes nothing. */
	const removeSkeleton = Workspace.prototype.remove_page_skeleton;
	Workspace.prototype.remove_page_skeleton = function () {
		const ready = this.editor?.isReady;
		if (!ready || window.themate?.enabled?.() === false) return removeSkeleton.apply(this, arguments);
		const args = arguments;
		let done = false;
		const go = () => {
			if (done) return;
			done = true;
			removeSkeleton.apply(this, args);
		};
		ready.then(go, go);
		setTimeout(go, 1500);
	};
	Workspace.prototype._tm_blocks = true;
})();
