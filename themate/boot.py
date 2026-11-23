from themate.api import get_theme_settings_dict, get_user_prefs


def extend_bootinfo(bootinfo):
	settings = get_theme_settings_dict()
	settings["user_prefs"] = get_user_prefs()
	# the sidebar's collapsed state etc.: in boot, so the sidebar can draw
	# at once from boot.allowed_workspaces instead of two requests later
	try:
		from themate.settings import get_settings

		settings["sidebar_settings"] = get_settings()
	except Exception:
		settings["sidebar_settings"] = None
	# document types whose calendar exists only through a Calendar Layout
	# (core/calendar.js registers them, so the Calendar view is offered)
	try:
		from themate.calendars import boot_calendars

		settings["calendar_layouts"] = boot_calendars()
	except Exception:
		settings["calendar_layouts"] = {}
	bootinfo.themate = settings
