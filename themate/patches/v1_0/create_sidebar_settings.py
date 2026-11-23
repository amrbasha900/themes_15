from __future__ import unicode_literals
import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

def execute():
    """Create the sidebar_settings custom field in User doctype"""
    
    # Check if the field already exists
    if frappe.db.exists("Custom Field", {"dt": "User", "fieldname": "sidebar_settings"}):
        return
    
    custom_fields = {
        "User": [
            {
                "fieldname": "sidebar_settings",
                "label": "Sidebar Settings",
                "fieldtype": "JSON",
                "insert_after": "desk_theme",
                "description": "Custom sidebar configuration settings in JSON format",
                "no_copy": 1,
                "hidden": True,
                "translatable": 0
            }
        ]
    }
    
    create_custom_fields(custom_fields)
    
    frappe.clear_cache(doctype="User")