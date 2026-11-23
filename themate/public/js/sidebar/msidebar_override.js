// Direct DOM manipulation to place custom sidebar before main-section
(function() {
    /* The old sidebar is part of the theme: with the master switch off
     * (core/bootstrap.js) the desk is Frappe's own, and nothing here may
     * mount, replace the navbar logo or hide the Workspaces sidebar. */
    if (document.documentElement.dataset.tmEnabled === "off") return;
    /* The setup wizard runs before any workspace or module exists: keep it
     * full-width like stock Frappe. It reloads the desk when it finishes. */
    if (!frappe.boot?.sysdefaults?.setup_complete) {
        document.documentElement.dataset.tmSetup = "pending";
        return;
    }
    // console.log("Custom sidebar initializing");
    
    // Function to initialize the custom sidebar
    function initializeCustomSidebar() {
        // console.log("Initializing custom sidebar...");
        
        // Check if our custom sidebar already exists
        if ($('.modern-sidebar').length > 0) {
            // console.log("Modern sidebar already exists");
            return;
        }
        
        // Look for the main-section element
        const mainSection = $('.main-section');
        if (mainSection.length === 0) {
            // console.log("Main section not found, trying again later");
            setTimeout(initializeCustomSidebar, 500);
            return;
        }
        
        // console.log("Found main-section, adding sidebar before it");
        
        // Create our container and add it before main-section
        const container = $('<div class="modern-sidebar-container"></div>');
        container.insertBefore(mainSection);
        
        // Initialize our ModernSidebar
        if (typeof frappe.ui.ModernSidebar === 'function') {
            $('.navbar-brand.navbar-home').replaceWith($(`
                <a class="navbar-brand modern-sidebar-toggle-nav" href="#">
                    <i class="fa fa-bars"></i>
                </a>
            `));
            // Kept on frappe so the Theme Customizer can toggle Expanded/Rail live.
            frappe.themate_sidebar = new frappe.ui.ModernSidebar(container);
            // console.log("Modern sidebar successfully initialized");
            
            // Hide any existing standard sidebar
            $('#page-Workspaces .layout-side-section').hide();
        } else {
            // console.error("ModernSidebar class not found");
        }
    }
    
    // Try to initialize immediately after page load
    if (document.readyState === "complete" || document.readyState === "interactive") {
        initializeCustomSidebar();
    } else {
        document.addEventListener("DOMContentLoaded", function() {
            initializeCustomSidebar()
        });
    }
    
    // Also try on jQuery ready
    $(document).ready(function() {
        initializeCustomSidebar()
    });
    
    // Also try after window load
    $(window).on('load', function() {
        if ($('.modern-sidebar').length === 0) {
            initializeCustomSidebar()
        }
    });
    
    // Use MutationObserver to detect when main-section is added to the DOM
    if (typeof MutationObserver !== 'undefined') {
        // Mounted once, then stops: this used to run two document-wide queries
        // per mutation record, for every DOM change in the desk, for the life
        // of the page. The route-change hook below covers a re-mount.
        const observer = new MutationObserver(function() {
            if (document.querySelector('.modern-sidebar')) return observer.disconnect();
            if (document.querySelector('.main-section')) initializeCustomSidebar();
        });
        
        // Start observing the document body
        observer.observe(document.body, { childList: true, subtree: true });
    }
    
    // If Frappe is available, hook into its events
    if (typeof frappe !== 'undefined') {
        // After route change
        if (frappe.router) {
            frappe.router.on('change', function() {
                if ($('.modern-sidebar').length === 0) {
                    initializeCustomSidebar();
                }
            });
        }
        
        // FIXED: Check if frappe.ready exists and handle properly
        if (typeof frappe.ready === 'function') {
            // If it's a function, use it as intended
            frappe.ready(function() {
                initializeCustomSidebar();
            });
        } else if (frappe.dom && typeof frappe.dom.ready === 'function') {
            // Some versions use frappe.dom.ready
            frappe.dom.ready(function() {
                initializeCustomSidebar();
            });
        } else {
            // Subscribe to 'ready' event if it exists
            $(document).on('frappe:ready', function() {
                initializeCustomSidebar();
            });
        }
        
        // After ajax calls complete
        $(document).ajaxComplete(function() {
            if ($('.modern-sidebar').length === 0) {
                initializeCustomSidebar();
            }
        });
    }
})();