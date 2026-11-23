#!/usr/bin/env python3
"""Builds themate/public/icons.svg — the Themate Business icon set.

Run from anywhere:  python3 tests/tools/build_icons.py
Needs the dev dependency:  cd tests && npm install   (@tabler/icons)

Every icon is a 24×24 duotone symbol `icon-tm-<name>`. The geometry is
Tabler Icons (MIT, https://tabler.io/icons): 24px grid, 2px round strokes,
5,000+ outline icons and 1,000+ filled counterparts. Three groups are built:

  FRAPPE    every id in frappe/public/icons/timeless/icons.svg — the names
            Frappe and ERPNext use for workspaces, shortcuts, list and form
            chrome — so core/icons.js can swap `icon-<name>` for
            `icon-tm-<name>` without any data changing;
  ESPRESSO  every id in frappe/public/icons/espresso/icons.svg (es-line-* and
            es-solid-*), the set v15 draws in sidebars, navbars and forms,
            registered under the bare name so the same swap applies;
  EXTRA     business icons for workspaces, shortcuts and smart widgets,
            registered under Tabler's own name (tm-file-invoice, tm-truck…).

Duotone: the stroke layer is the outline icon; the tint layer is Tabler's
filled variant when one exists, otherwise the outline's closed shapes.
Authoring rules — what makes size, weight, tint and colour controllable from
CSS (tokens/_semantic.scss `--tm-icon-*`):

  * shapes carry fill="currentColor" (tint layer) or stroke="currentColor"
    (line layer) EXPLICITLY, so Frappe's `.icon { fill: …; stroke: … }` —
    which inherits into the <use> shadow tree — cannot repaint them;
  * shapes carry NO stroke-width and NO fill-opacity, so those two inherit
    from the <svg>, where the theme sets them from --tm-icon-stroke and
    --tm-icon-tint. Setting either as an attribute here would freeze it.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "themate" / "public" / "icons.svg"
TABLER = ROOT / "tests" / "node_modules" / "@tabler" / "icons" / "icons"

# ---- Frappe timeless ids -> Tabler outline name ---------------------------
FRAPPE = {
	"up-line": "chevron-up", "small-up": "chevron-up", "up": "chevron-up", "down": "chevron-down",
	"small-down": "chevron-down", "right": "chevron-right", "left": "chevron-left",
	"up-arrow": "arrow-up", "down-arrow": "arrow-down", "arrow-left": "arrow-left", "arrow-right": "arrow-right",
	"move": "arrows-move", "unhide": "eye", "hide": "eye-off", "view": "eye",
	"sidebar-collapse": "layout-sidebar-left-collapse", "sidebar-expand": "layout-sidebar-left-expand",
	"change": "arrows-exchange", "sort": "arrows-sort", "select": "selector",
	"arrow-up-right": "arrow-up-right", "arrow-down-left": "arrow-down-left", "arrow-down-right": "arrow-down-right",
	"expand": "arrows-maximize", "collapse": "arrows-minimize", "expand-alt": "maximize", "shrink": "minimize",
	"external-link": "external-link", "both": "arrows-vertical",
	"small-add": "plus", "add": "plus", "add-round": "circle-plus", "remove": "x", "close": "x", "close-alt": "x",
	"check": "check", "tick": "check", "dot-horizontal": "dots", "dot-vertical": "dots-vertical",
	"drag": "grip-vertical", "drag-sm": "grip-vertical", "dialpad": "grid-dots",
	"unread-status": "mail", "read-status": "mail-opened", "mark-as-read": "mail-check",
	"insert-below": "row-insert-bottom", "insert-above": "row-insert-top", "group-by": "category",
	"kanban": "layout-kanban", "sort-descending": "sort-descending", "sort-ascending": "sort-ascending",
	"gantt": "chart-arrows", "filter": "filter", "filter-x": "filter-off", "list": "list", "menu": "menu-2",
	"table": "table", "heart": "heart", "heart-active": "heart", "lock": "lock", "unlock": "lock-open",
	"delete": "trash", "delete-active": "trash", "pen": "pencil", "edit": "edit", "edit-fill": "edit",
	"edit-round": "pencil", "review": "star", "star": "star", "notification": "bell",
	"notification-with-indicator": "bell-ringing", "message": "message", "message-1": "message-circle",
	"small-message": "message", "comment": "message-2", "refresh": "refresh", "upload": "upload",
	"upload-lg": "cloud-upload", "tag": "tag", "restriction": "ban", "attachment": "paperclip",
	"call": "phone", "full-page": "arrows-diagonal", "crop": "crop", "scan": "scan", "link-url": "link",
	"map": "map", "search": "search", "website": "world", "users": "users", "tool": "tool",
	"support": "headset", "stock": "package", "setting": "settings", "setting-gear": "settings",
	"sell": "tag", "retail": "building-store", "quantity-1": "packages", "quality": "award",
	"quality-3": "rosette-discount-check", "projects": "clipboard-list", "project": "clipboard",
	"project-1": "clipboard-check", "project-2": "clipboard-text", "folder-open": "folder-open",
	"folder-normal": "folder", "folder-normal-large": "folder", "organization": "building",
	"non-profit": "heart-handshake", "money-coins-1": "coins", "loan": "cash-banknote",
	"integration": "plug", "hr": "users-group", "getting-started": "rocket", "onboarding": "rocket",
	"education": "school", "customization": "adjustments", "crm": "address-book", "equity": "chart-pie",
	"buying": "shopping-cart", "assets": "briefcase", "agriculture": "plant", "accounting": "calculator",
	"healthcare": "stethoscope", "expenses": "receipt-2", "income": "coin", "liabilities": "scale",
	"file": "file", "file-large": "file", "small-file": "file-text", "list-alt": "list-details",
	"milestone": "flag", "image": "photo", "image-view": "photo", "today": "calendar-event",
	"primitive-dot": "circle-dot", "keyboard": "keyboard", "mail": "mail", "calendar": "calendar",
	"assign": "user-plus", "customer": "user", "share": "share", "share-people": "share-2",
	"branch": "git-branch", "reply": "arrow-back-up", "reply-all": "arrow-back-up-double",
	"printer": "printer", "permission": "shield-lock", "month-view": "calendar-month",
	"dashboard": "layout-dashboard", "dashboard-list": "layout-list", "clap": "thumb-up",
	"criticize": "thumb-down", "card": "layout-cards", "duplicate": "copy", "chart": "chart-bar",
	"shortcut": "bolt", "spacer": "separator-horizontal", "number-card": "number-123",
	"workflow": "sitemap", "text": "typography", "header": "heading", "header-1": "heading",
	"header-2": "heading", "header-3": "heading", "header-4": "heading", "header-5": "heading",
	"header-6": "heading", "help": "help-circle", "solid-error": "circle-x", "solid-info": "info-circle",
	"solid-success": "circle-check", "solid-warning": "alert-triangle",
	"color-energy-points": "bolt", "color-monthly-rank": "trophy", "color-rank": "medal",
	"color-review-points": "star", "clipboard": "clipboard",
}

# ---- Frappe espresso ids (es-line-* / es-solid-*) -> Tabler ----------------
ESPRESSO = {
	"add-people": "user-plus", "resizer": "arrows-diagonal-2", "text-cursor": "cursor-text",
	"success": "circle-check", "alert-triangle": "alert-triangle", "alert-circle": "alert-circle",
	"close-circle": "circle-x", "delete-alt": "trash-x", "email": "mail", "sparkle": "sparkles",
	"filetype": "file-description", "zap": "bolt", "dash": "minus", "slash": "slash", "dot": "point",
	"overflow": "dots", "inbox": "inbox", "edit-alt": "pencil", "location": "map-pin",
	"location-alt": "map-pin", "settings": "settings", "people": "users", "emoji": "mood-smile",
	"calender": "calendar", "home": "home", "chat": "message-circle", "teams": "users-group",
	"add-emoji": "mood-plus", "template": "template", "table-view": "table", "image-alt1": "photo",
	"code": "code", "chat-alt": "messages", "tomorrow": "calendar-due", "today-alt": "calendar-event",
	"status": "circle-dot", "quotes-alt": "quote", "copy": "copy", "copy-light": "copy", "pin": "pin",
	"unpin": "pinned-off", "divider": "separator", "tiles": "layout-grid", "mark-unread": "mail",
	"link": "link", "bold": "bold", "italic": "italic", "strike-through": "strikethrough",
	"underline": "underline", "numbered-list": "list-numbers", "bullet-list": "list", "align": "align-left",
	"quote": "blockquote", "decrease-indent": "indent-decrease", "increase-indent": "indent-increase",
	"web": "world", "ticket": "ticket", "ticket-no-": "ticket-off", "ticket-alt": "ticket",
	"activity": "activity", "notifications": "bell", "notifications-unseen": "bell-ringing",
	"reports": "report", "report": "report", "book": "book", "log-out": "logout", "compact": "arrows-minimize",
	"reload": "reload", "add-circle": "circle-plus", "time": "clock", "overdue": "clock-exclamation",
	"details": "info-square-rounded", "double-check": "checks", "agent": "headset", "agent-alt": "user-cog",
	"manage": "adjustments", "video": "video", "question": "help", "demand-video": "player-play",
	"certificates": "certificate", "like": "thumb-up", "dislike": "thumb-down", "progress": "progress",
	"inprogress": "progress", "plans": "layout-list", "plan": "route", "payments": "credit-card",
	"folder": "folder", "folder-alt": "folder", "article": "article", "create-ticket": "ticket",
	"cloud": "cloud", "select-file": "file-plus", "quiz": "checklist", "youtube": "brand-youtube",
	"embed": "code", "download": "download", "web-link": "link", "archive": "archive", "title": "heading",
	"unarchive": "archive-off", "darkmode": "moon", "right-chevron": "chevron-right",
	"left-chevron": "chevron-left", "align-center": "align-center", "align-right": "align-right",
	"align-justify": "align-justified", "discussions": "messages", "camera": "camera", "cursor": "pointer",
	"weekend": "calendar-week", "nextweek": "calendar-plus", "colour": "palette",
	"header-column": "table-column", "header-row": "table-row", "all-apps": "apps",
	"folder-upload": "folder-up", "file-upload": "file-upload", "new-folder": "folder-plus",
	"notes": "notes", "storage": "database", "preview": "eye", "globe": "world", "folder-shared": "folders",
	"shared-folder": "folders", "shared-folder-alt": "folders", "security": "shield-check",
	"privacy-alt": "shield-lock", "laptop": "device-laptop", "mobile": "device-mobile",
	"minimise": "minimize", "pages": "files", "pages-alt": "files", "wifi-off": "wifi-off",
	"square": "square", "pentagon": "pentagon", "restrictions": "ban", "group": "users-group",
	"fire": "flame", "user": "user", "google": "brand-google", "github": "brand-github",
	"facebook": "brand-facebook", "apple": "brand-apple", "knob": "adjustments", "heading": "heading",
	"lighting": "bolt", "stage": "flag-3", "type": "typography", "text-alt": "text-size",
	"everyone": "world", "black": "circle", "white": "circle", "arrow-up": "arrow-up",
	"play": "player-play", "pdf": "file-type-pdf", "zip": "file-zip", "doc": "file-type-doc",
	"excel": "file-type-xls", "sketch": "brand-sketch", "aftereffects": "brand-adobe-after-effects",
	"dropbox": "brand-dropbox", "word": "file-type-docx", "audio": "file-music",
	"illustrator": "brand-adobe-illustrator", "photoshop": "brand-adobe-photoshop", "music": "music",
	"color-wheel": "color-swatch", "calendar": "calendar", "customer": "user",
	# HR workspaces (Frappe HR names them, its sprite draws them): a badge, a door, a clock on a calendar
	"employee": "id-badge-2", "employee-exit": "door-exit", "time-management": "calendar-clock",
	"hr-control-tower": "radar-2",
}

# ---- Business extras, under Tabler's own names ------------------------------
EXTRA = """
	file-invoice receipt receipt-2 receipt-tax wallet building-bank pig-money cash cash-banknote
	currency-dollar coin coins credit-card report-money invoice percentage discount rosette-discount
	target trophy medal briefcase signature file-certificate contract scale hourglass alarm clock
	calendar-check calendar-clock calendar-stats presentation chart-line chart-area chart-donut
	chart-pie chart-bar chart-arrows chart-histogram timeline building building-store
	building-warehouse building-factory-2 building-skyscraper building-community truck
	truck-delivery truck-loading package packages box basket shopping-cart shopping-bag barcode
	qrcode plane ship car bus gas-station map-pin map-2 route world tools tool hammer
	settings-2 cpu server database cloud shield shield-check shield-lock key id-badge user
	user-check user-search user-cog users users-group mail send message messages phone headset
	lifebuoy help flag tag tags bookmark star sparkles bolt sun moon leaf plant recycle droplet
	temperature flame stethoscope heartbeat pill first-aid-kit school book notebook certificate
	ruler clipboard-check list-check checklist layout-dashboard layout-kanban layout-grid
	calendar-event file-text file-spreadsheet file-analytics files folder folders archive printer
	camera photo video microphone rocket award home layout-list list-details table filter search
	eye lock link paperclip download upload refresh inbox bell trash pencil copy adjustments
	category sitemap git-branch device-laptop device-mobile device-desktop palette calculator
	address-book school stethoscope plant heart-handshake wave-sine
	pencil-dollar affiliate stack-2 arrows-exchange arrows-sort abacus businessplan cash-register
	coin-euro coin-pound coin-rupee coin-yen building-estate clipboard-data
	device-analytics gauge versions zoom-money zoom-scan
""".split()

ALIASES = {"themate-sidebar": "menu-2"}  # legacy id kept for the sidebar toggle
LEGACY = {  # ids some stored workspace configs still name
	"color-money": "coins", "color-users": "users", "color-stock": "package", "color-file": "file",
	"color-chart": "chart-bar", "color-list": "list", "color-calendar": "calendar", "color-award": "trophy",
	"color-folder": "folder", "color-settings": "settings", "color-dashboard": "layout-dashboard",
}

# one <g> per layer carries the paint (the sprite is inlined in every desk
# page; attributes per path would double its size)
FILL_ATTRS = 'class="tm-fill" fill="currentColor" stroke="none"'
LINE_ATTRS = 'class="tm-line" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"'
PATH_RE = re.compile(r'<path\s+([^>]*?)d="([^"]+)"([^>]*)/>')
BACKGROUND = "M0 0h24v24H0z"


def paths(svg_text):
	out = []
	for m in PATH_RE.finditer(svg_text):
		d = m.group(2).strip()
		if d == BACKGROUND:
			continue
		out.append(re.sub(r"\s+", " ", d))
	return out


def tabler(kind, name):
	p = TABLER / kind / f"{name}.svg"
	return paths(p.read_text()) if p.exists() else None


def duotone(name):
	"""(fill paths, line paths) for a Tabler icon name, or None if unknown."""
	lines = tabler("outline", name)
	if lines is None:
		return None
	fills = tabler("filled", name)
	if fills is None:
		# closed shapes of the outline carry the tint; open strokes stay lines
		fills = [d for d in lines if d.rstrip().lower().endswith("z")]
	return fills, lines


def symbol(sid, fills, lines):
	body = ""
	if fills:
		body += f"<g {FILL_ATTRS}>" + "".join(f'<path d="{d}"/>' for d in fills) + "</g>"
	body += f"<g {LINE_ATTRS}>" + "".join(f'<path d="{d}"/>' for d in lines) + "</g>"
	return f'<symbol id="{sid}" viewBox="0 0 24 24">{body}</symbol>'


def build():
	if not TABLER.exists():
		sys.exit(f"Tabler icons not found at {TABLER}: run `npm install` in tests/ first")
	symbols = {}  # tm name -> (fills, lines)
	missing = []

	def register(tm_name, tabler_name):
		if tm_name in symbols:
			return
		shapes = duotone(tabler_name)
		if shapes is None:
			missing.append((tm_name, tabler_name))
			return
		symbols[tm_name] = shapes

	for name, tab in FRAPPE.items():
		register(name, tab)
	for name, tab in ESPRESSO.items():
		register(name, tab)
	for tab in EXTRA:
		register(tab, tab)

	parts = ['<svg xmlns="http://www.w3.org/2000/svg" style="display: none;">',
		"<!-- GENERATED by tests/tools/build_icons.py from Tabler Icons (MIT, https://tabler.io/icons) — edit the generator, not this file. -->"]
	for name, (fills, lines) in symbols.items():
		parts.append(symbol(f"icon-tm-{name}", fills, lines))
	for legacy, tab in list(ALIASES.items()) + list(LEGACY.items()):
		shapes = duotone(tab)
		if shapes:
			parts.append(symbol(f"icon-{legacy}", *shapes))
	parts.append("</svg>\n")
	OUT.write_text("\n".join(parts))
	size = OUT.stat().st_size
	print(f"{OUT.name}: {len(symbols)} tm icons (+{len(ALIASES) + len(LEGACY)} legacy ids), {size // 1024} KB")
	if missing:
		print("MISSING in Tabler:", ", ".join(f"{a}->{b}" for a, b in missing))


if __name__ == "__main__":
	build()
