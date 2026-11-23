/* Reserved for keyboard-shortcut adapters.
 *
 * Intentionally inert: Frappe already owns Desk shortcuts
 * (frappe/public/js/frappe/ui/keyboard.js) and the brief requires native
 * shortcuts to keep working. Nothing here overrides them; the module exists so
 * the namespace is defined before other modules extend it. */
window.themate = window.themate || {};
