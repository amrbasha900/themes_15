import json

import frappe
from frappe.utils import cint


@frappe.whitelist()
def save_settings(settings):
    """
    Save sidebar settings
    """
    settings = _normalize_settings(settings)
    user = frappe.session.user

    _cache_settings(user, settings)

    if _has_sidebar_settings_column():
        try:
            frappe.db.set_value("User", user, "sidebar_settings", json.dumps(settings))
            return True
        except Exception:
            pass

    _save_user_preference(user, settings)
    return True


@frappe.whitelist()
def get_settings():
    """
    Get sidebar settings
    """
    user = frappe.session.user

    cached_settings = frappe.cache().hget("sidebar_settings", user)
    if cached_settings:
        return _normalize_settings(cached_settings)

    settings = _get_user_doc_settings(user) or _get_user_preference_settings(user) or get_default_settings()
    _cache_settings(user, settings)
    return settings


def get_default_settings():
    """
    Default sidebar state for a user who has never toggled it: Theme
    Settings > Sidebar Default ("Rail" starts collapsed).
    """
    try:
        rail = frappe.db.get_single_value("Theme Settings", "sidebar_default") == "Rail"
    except Exception:
        rail = False
    return {
        "collapsed": 1 if rail else 0
    }


def _normalize_settings(settings):
    if not settings:
        return get_default_settings()

    if isinstance(settings, bytes):
        settings = settings.decode()

    if isinstance(settings, str):
        try:
            settings = json.loads(settings)
        except Exception:
            return get_default_settings()

    if not isinstance(settings, dict):
        return get_default_settings()

    return {
        "collapsed": cint(settings.get("collapsed", settings.get("sidebar_collapsed", 0)))
    }


def _cache_settings(user, settings):
    frappe.cache().hset("sidebar_settings", user, settings)


def _has_sidebar_settings_column():
    try:
        return frappe.db.has_column("User", "sidebar_settings")
    except Exception:
        return False


def _get_user_doc_settings(user):
    if not _has_sidebar_settings_column():
        return None

    try:
        settings = frappe.db.get_value("User", user, "sidebar_settings")
    except Exception:
        return None

    if not settings:
        return None

    return _normalize_settings(settings)


def _preference_doctype_exists():
    try:
        return frappe.db.exists("DocType", "Themate User Preference")
    except Exception:
        return False


def _get_user_preference_settings(user):
    if not _preference_doctype_exists():
        return None

    try:
        if not frappe.db.exists("Themate User Preference", user):
            return None

        doc = frappe.get_cached_doc("Themate User Preference", user)
        return {"collapsed": cint(doc.sidebar_collapsed)}
    except Exception:
        return None


def _save_user_preference(user, settings):
    if not _preference_doctype_exists():
        return

    try:
        if frappe.db.exists("Themate User Preference", user):
            doc = frappe.get_doc("Themate User Preference", user)
        else:
            doc = frappe.get_doc({"doctype": "Themate User Preference", "user": user})

        doc.sidebar_collapsed = cint(settings.get("collapsed"))
        doc.save(ignore_permissions=True)
        frappe.clear_document_cache("Themate User Preference", user)
    except Exception:
        pass
