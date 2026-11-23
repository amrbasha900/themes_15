from . import __version__ as version

app_name = "themate"
app_title = "Themate"
app_publisher = "Innomate LLC"
app_description = "A Theme for Frappe 15"
app_email = "info@innomate-tech.com"
app_license = "mit"

# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "themate",
# 		"logo": "/assets/themate/logo.png",
# 		"title": "Themate",
# 		"route": "/themate",
# 		"has_permission": "themate.api.permission.has_app_permission"
# 	}
# ]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# Only content-hashed bundles. The sidebar's css/js used to be listed here as
# bare /assets paths; nginx serves /assets with Cache-Control max-age of a
# year, so every change to them was invisible to an existing browser. They
# are now imported by the two bundles (see themate.bundle.scss / .js).
app_include_css = ["themate.bundle.css"]

app_include_js = ["themate.bundle.js"]

# include js, css files in header of web template
web_include_css = ["themate-login.bundle.css"]
# web_include_js = "/assets/themate/js/themate.js"

extend_bootinfo = "themate.boot.extend_bootinfo"

# /themate-print/<name>.pdf — the print studio's exact preview; see themate/print_pdf.py
page_renderer = ["themate.print_pdf.PrintPDF"]

# the splash screen's logo, colour and name from Theme Settings (themate/splash.py)
update_website_context = ["themate.splash.context"]

website_context = {
	"favicon": "/assets/themate/images/favicon.png",
	"splash_image": "/assets/themate/images/splash.svg",
}

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "themate/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
app_include_icons = ["themate/icons.svg"]

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# `/` and `/index` send a signed-in desk user to the desk instead of the
# portal's My Account page; guests and portal users are unchanged.
get_website_user_home_page = "themate.website.get_home_page"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "themate.utils.jinja_methods",
# 	"filters": "themate.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "themate.install.before_install"
after_install = "themate.install.after_install"
after_migrate = "themate.install.after_migrate"

# Uninstallation
# ------------

# before_uninstall = "themate.uninstall.before_uninstall"
# after_uninstall = "themate.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "themate.utils.before_app_install"
# after_app_install = "themate.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "themate.utils.before_app_uninstall"
# after_app_uninstall = "themate.utils.after_app_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "themate.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# DocType Class
# ---------------
# Override standard doctype classes

# override_doctype_class = {
# 	"ToDo": "custom_app.overrides.CustomToDo"
# }

# Document Events
# ---------------
# Hook on document methods and events

# doc_events = {
# 	"*": {
# 		"on_update": "method",
# 		"on_cancel": "method",
# 		"on_trash": "method"
# 	}
# }

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"themate.tasks.all"
# 	],
# 	"daily": [
# 		"themate.tasks.daily"
# 	],
# 	"hourly": [
# 		"themate.tasks.hourly"
# 	],
# 	"weekly": [
# 		"themate.tasks.weekly"
# 	],
# 	"monthly": [
# 		"themate.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "themate.install.before_tests"

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "themate.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "themate.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["themate.utils.before_request"]
# after_request = ["themate.utils.after_request"]

# Job Events
# ----------
# before_job = ["themate.utils.before_job"]
# after_job = ["themate.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"themate.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }
