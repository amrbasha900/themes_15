/* Themate Desk JS bundle.
 * Loaded via hooks.py `app_include_js`, after Frappe's own desk bundle
 * (verified: frappe/www/app.py:47).
 *
 * Order matters: palette provides the ramp generator, bootstrap consumes it to
 * set the theme, font and brand tokens on <html> before anything else reads
 * them, and theme_switcher reuses bootstrap's accent resolver. */
import "./core/splash";
import "./core/palette";
import "./core/icons";
import "./core/art_svgs";
import "./core/art";
import "./core/bootstrap";
import "./core/store";
import "./core/shortcuts";
import "./core/theme_switcher";
import "./core/loading";
import "./core/progress";
import "./core/toasts";
import "./core/page_head";
import "./core/page_fit";
import "./core/scroll_chrome";
import "./core/form_skeleton";
import "./core/form_overview";
import "./core/form_360";
import "./core/form_tabs";
import "./core/form_activity";
import "./core/grid_text";
import "./core/user_profile";
import "./core/not_found";
import "./core/list_panel";
import "./core/list_skeleton";
import "./core/linked_filters";
import "./core/list_filters";
import "./core/print_studio";
import "./core/list_pager";
import "./core/board";
import "./core/calendar";
import "./core/report_columns";
import "./core/customizer";
import "./core/navbar_tools";
import "./core/search";
import "./core/whitelabel";
import "./core/charts";
import "./workspace/cards";
import "./workspace/blocks";

/* The persistent custom sidebar and the script that mounts it. Bundled here
 * for the same reason as the CSS: as bare /assets includes they were cached
 * for a year and no fix reached an existing browser. Order preserved. */
import "./sidebar/modern_sidebar";
import "./sidebar/msidebar_override";
