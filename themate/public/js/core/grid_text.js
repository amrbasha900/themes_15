/* Child table: a long-text value (Small Text / Text / Long Text) reads as one
 * line that runs to the end of its cell.
 *
 * frappe.format() turns every line break into <br> (grid_row.js:730, :1502),
 * so a remark typed on three lines showed its first line and stopped half way
 * across the cell, however wide the column. Here the breaks become spaces in
 * the cell's summary only — the value, the textarea and the expanded row
 * editor keep them. CSS cannot do it: Chromium ignores `content` on <br>.
 *
 * GridRow is not exported (grid.js imports it), so it is reached through the
 * first grid built: ControlTable -> Grid.make_head -> header_row.constructor.
 * The header row is made before any data row (grid.js:431 then :507). */
(function () {
	const frappe = window.frappe;
	const ControlTable = frappe?.ui?.form?.ControlTable;
	if (!ControlTable || ControlTable.prototype._tm_grid_text) return;

	const TEXT = new Set(["Small Text", "Text", "Long Text"]);
	const enabled = () => window.themate?.enabled?.() !== false;

	function flatten($col) {
		const area = $col?.static_area?.[0];
		if (!area || !enabled() || !TEXT.has($col.df?.fieldtype)) return;
		area.querySelectorAll("br").forEach((br) => br.replaceWith(" "));
	}

	function patchRow(GridRow) {
		const proto = GridRow?.prototype;
		if (!proto || proto._tm_grid_text) return;

		const makeColumn = proto.make_column;
		proto.make_column = function () {
			const $col = makeColumn.apply(this, arguments);
			if (this.doc) flatten($col);
			return $col;
		};

		const refreshField = proto.refresh_field;
		proto.refresh_field = function (fieldname) {
			const out = refreshField.apply(this, arguments);
			flatten(this.columns?.[fieldname]);
			return out;
		};

		proto._tm_grid_text = true;
	}

	function patchGrid(Grid) {
		const proto = Grid?.prototype;
		if (!proto || proto._tm_grid_text || typeof proto.make_head !== "function") return;

		const makeHead = proto.make_head;
		proto.make_head = function () {
			const out = makeHead.apply(this, arguments);
			patchRow(this.header_row?.constructor);
			return out;
		};

		proto._tm_grid_text = true;
	}

	const make = ControlTable.prototype.make;
	ControlTable.prototype.make = function () {
		const out = make.apply(this, arguments);
		patchGrid(this.grid?.constructor);
		return out;
	};

	ControlTable.prototype._tm_grid_text = true;
})();
