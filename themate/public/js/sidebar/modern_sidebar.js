/* Bundled into themate.bundle.js (see themate.bundle.js) so it ships
 * content-hashed. As a bare /assets include it sat behind nginx's one-year
 * Cache-Control and no change ever reached an existing browser. Inside a
 * module, top-level `this` is undefined, so the stray `this.settings = {…}`
 * that used to sit here (never read; every reader uses the instance's
 * `this.settings`) is gone. */
frappe.provide("frappe.ui");

// Define our Modern Sidebar class
frappe.ui.ModernSidebar = class ModernSidebar {
    constructor(parent) {
        this.parent = parent;
        this.setup_sidebar();
    }

    setup_sidebar() {
        // Remove existing sidebar if it exists
        $(this.parent).empty();

        this.sidebar = $(`<div class="modern-sidebar"></div>`).appendTo(this.parent);

        // Create sidebar header with logo and toggle button
        this.sidebar_header = $(`
        <div class="modern-sidebar-header">
            <div class="modern-sidebar-logo"><a href="/app">
                ${(() => {
                    /* Theme Settings > App Logo / App Logo (Dark). Both are
                     * rendered; _modern-sidebar.scss shows one per theme. */
                    const theme = (frappe.boot && frappe.boot.themate) || {};
                    const light = theme.app_logo || "/assets/themate/images/Innomate-logo.png";
                    const dark = theme.app_logo_dark || light;
                    /* Theme Settings > Brand > App Name first, then System Settings. */
                    const name = theme.app_name || frappe.boot?.sysdefaults?.app_name || "";
                    return `<img class="tm-logo tm-logo-light" src="${light}" alt="Logo">` +
                           `<img class="tm-logo tm-logo-dark" src="${dark}" alt="Logo">` +
                           (name ? `<span class="tm-app-name">${frappe.utils.escape_html(name)}</span>` : "");
                })()}
                </a>
            </div>
            <div class="modern-sidebar-toggle">
                <button class="btn-reset">
                    <i class="fa fa-bars"></i>
                </button>
            </div>
        </div>
    `).appendTo(this.sidebar);

        // Create sidebar menu container
        this.sidebar_menu = $(`<div class="modern-sidebar-menu"></div>`).appendTo(this.sidebar);

        // Footer: who is signed in, and the collapse control (design: bottom of the rail).
        // Read from boot, not frappe.session: the sidebar mounts on DOMContentLoaded,
        // before frappe.app has copied the session fields over.
        const user = frappe.boot?.user?.name || frappe.session.user;
        const full_name = frappe.boot?.user_info?.[user]?.fullname || frappe.session.user_fullname || user;
        this.sidebar_footer = $(`
        <div class="modern-sidebar-footer">
            <a class="modern-sidebar-user" href="/app/user-profile" title="${frappe.utils.escape_html(full_name)}">
                ${frappe.avatar(user, "avatar-small")}
                <span class="modern-sidebar-user-text">
                    <span class="modern-sidebar-user-name">${frappe.utils.escape_html(full_name)}</span>
                    <span class="modern-sidebar-user-email">${frappe.utils.escape_html(frappe.boot?.user?.email || user)}</span>
                </span>
            </a>
            <button type="button" class="btn-reset modern-sidebar-logout" title="${__("Log out")}" aria-label="${__("Log out")}">
                ${frappe.utils.icon("arrow-right", "sm")}
            </button>
            <button type="button" class="btn-reset modern-sidebar-collapse" title="${__("Toggle Sidebar")}" aria-label="${__("Toggle Sidebar")}">
                ${frappe.utils.icon("arrow-left", "sm")}
            </button>
        </div>`).appendTo(this.sidebar);
        this.sidebar_footer.find(".modern-sidebar-collapse").on("click", () => this.toggle_sidebar());
        /* Frappe's own logout (toolbar.js): clears the session and goes to /login */
        this.sidebar_footer.find(".modern-sidebar-logout").on("click", () => frappe.app?.logout?.());
        /* Theme Settings > Sidebar > Show User Card */
        if (frappe.boot?.themate?.sidebar_show_user_card === 0) {
            this.sidebar_footer.find(".modern-sidebar-user, .modern-sidebar-logout").remove();
            this.sidebar_footer.addClass("modern-sidebar-footer-bare");
        }

        // First fetch sidebar settings, then initialize components
        this.fetch_sidebar_settings().then(() => {
            // Setup sidebar toggle functionality
            this.enable_full_width();
            this.setup_sidebar_toggle();

            // Initialize sidebar components
            this.setup_workspace_menu();
            // this.setup_modules_menu();

            // Bind events
            this.bind_events();

            // Apply responsive behavior
            this.apply_responsive_behavior();

            this.update_active_items();
        });
    }

    /* The sidebar's layout offsets assume a full-width container, so full width
     * is a sensible DEFAULT here — but it is the user's setting, not ours.
     * This used to write localStorage.container_fullwidth unconditionally on
     * every page load, silently undoing the user's own choice from the Frappe
     * toolbar menu each time they navigated. Now it only seeds the value when
     * the user has never expressed a preference.
     *
     * Frappe reads it as JSON.parse(localStorage.container_fullwidth || "false")
     * — frappe/public/js/frappe/ui/toolbar/toolbar.js:220 — so the stored form
     * must stay a JSON boolean string. */
    enable_full_width() {
        if (localStorage.getItem("container_fullwidth") === null) {
            localStorage.setItem("container_fullwidth", "true");
        }

        let fullwidth = false;
        try {
            fullwidth = JSON.parse(localStorage.container_fullwidth || "false");
        } catch (e) {
            fullwidth = false;
        }

        $("body").toggleClass("full-width", fullwidth);
        frappe.ui.toolbar?.set_fullwidth_if_enabled?.();
        $(document.body).trigger("toggleFullWidth");
    }

    fetch_sidebar_settings() {
        /* boot carries the settings (themate/boot.py): no request, no wait */
        const booted = frappe.boot?.themate?.sidebar_settings;
        if (booted) {
            this.settings = booted;
            this.sidebar.toggleClass('collapsed', !!booted.collapsed);
            this.sync_collapsed_state();
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            frappe.call({
                method: 'themate.settings.get_settings',
                callback: (r) => {
                    if (r.message) {
                        this.settings = r.message;

                        // Apply collapsed state from settings
                        if (this.settings.collapsed) {
                            this.sidebar.addClass('collapsed');
                        } else {
                            this.sidebar.removeClass('collapsed');
                        }
                        this.sync_collapsed_state();
                    } else {
                        this.settings = {
                            collapsed: 0,
                            sections: {
                                workspaces: { visible: 1, expanded: 1 },
                                modules: { visible: 1, expanded: 1 },
                                help: { visible: 1, expanded: 1 }
                            }
                        };
                        this.sync_collapsed_state();
                    }
                    resolve();
                },
                error: () => {
                    // Use default settings if call fails
                    this.settings = {
                        collapsed: 0,
                        sections: {
                            workspaces: { visible: 1, expanded: 1 },
                            modules: { visible: 1, expanded: 1 },
                            help: { visible: 1, expanded: 1 }
                        }
                    };
                    this.sync_collapsed_state();
                    resolve();
                }
            });
        });
    }

    setup_sidebar_toggle() {
        // Add toggle functionality to the sidebar toggle button
        this.sidebar_header.find('.modern-sidebar-toggle button').on('click', () => {
            this.toggle_sidebar();
        });

        // Replace navbar-brand navbar-home with modern-sidebar-toggle.
        //
        // The sidebar mounts on DOMContentLoaded, and Frappe renders the navbar
        // later (toolbar.js, then `toolbar_setup`). When the sidebar wins that
        // race the replacement finds nothing, the native <a href="/app"> stays
        // — drawn as a burger by the fallback CSS — and Frappe's router sends
        // the click to Home. So: replace now, replace again on toolbar_setup,
        // and catch the click in the CAPTURE phase, before the router's own
        // body-level handler can act on the href.
        const replace_home_link = () => {
            $('.navbar-brand.navbar-home').replaceWith($(`
                <a class="navbar-brand modern-sidebar-toggle-nav" href="#" role="button" aria-label="${__("Toggle Sidebar")}">
                    <i class="fa fa-bars"></i>
                </a>
            `));
        };
        replace_home_link();
        $(document).off('toolbar_setup.modern-sidebar-toggle').on('toolbar_setup.modern-sidebar-toggle', replace_home_link);

        if (!document._modern_sidebar_capture) {
            document._modern_sidebar_capture = (e) => {
                const link = e.target.closest && e.target.closest('.modern-sidebar-toggle-nav, .navbar-brand.navbar-home');
                if (!link) return;
                e.preventDefault();
                e.stopPropagation();
                const sidebar = frappe.themate_sidebar;
                if (sidebar && sidebar.toggle_sidebar) sidebar.toggle_sidebar();
            };
            document.addEventListener('click', document._modern_sidebar_capture, true);
        }

        $('.modern-sidebar-container').on('click', (e) => {
            if ($(e.target).closest('.modern-sidebar').length === 0) {
                // Only if click is NOT inside .modern-sidebar
                e.preventDefault();
                this.toggle_sidebar();
            }
        });
    }

    toggle_sidebar() {
        /* the label fade (_modern-sidebar.scss) runs only under this class,
         * so a sidebar that is merely drawn or redrawn never animates */
        clearTimeout(this._toggling);
        this.sidebar.addClass('tm-sb-toggling');
        this._toggling = setTimeout(() => this.sidebar.removeClass('tm-sb-toggling'), 350);
        this.sidebar.toggleClass('collapsed');

        // Save the collapsed state using our custom method
        const collapsed = this.sidebar.hasClass('collapsed') ? 1 : 0;

        // Update local settings
        this.settings.collapsed = collapsed;

        // Update icon sizes based on collapsed state
        if (this.settings.collapsed) {
            this.sidebar.find('.icon-md').removeClass('icon-md').addClass('icon-lg');
        } else {
            this.sidebar.find('.icon-lg').removeClass('icon-lg').addClass('icon-md');

            // Hide any visible submenus when expanding
            $('.submenu-visible').removeClass('submenu-visible');
        }
        this.sync_collapsed_state();

        // Save to server
        let settings = JSON.parse(localStorage.getItem('sidebar_settings') || '{}');

        // Update the collapsed state
        settings.collapsed = collapsed;

        frappe.call({
            method: 'themate.settings.save_settings',
            args: {
                settings: {
                    collapsed: collapsed
                }
            }
        });
    }

    sync_collapsed_state() {
        $('body').toggleClass('sidebar-collapsed', this.sidebar.hasClass('collapsed'));
    }

    setup_workspace_menu(pages) {
        /* Keep the modern sidebar design, but render Frappe's allowed list in
         * its original sequence under one visual section. */
        const GROUP_ORDER = [__("Workspace"), __("My Workspaces"), __("Operations"), __("Administration")];
        const MINE = GROUP_ORDER[1];
        /* The theme owns presentation only. Visibility and sequence come from
         * Frappe's allowed_workspaces exactly as received. */
        const overrides = {};
        const hidden_ws = new Set();
        const hidden_groups = new Set();
        const show_mine = true;
        /* Departments (Themate Department): the one chosen, or all of the
         * person's, come first as their own sections, in their own order.
         * Only the workspaces a department lists show (their children too
         * only when listed); another department's are left out; the rest follow
         * Theme Settings > Workspaces Outside Departments. None: as before. */
        const D = null;
        const shown_depts = D ? (D.all ? D.list : [D.current]) : [];
        /* Inside its department a row's Category is a label over its rows:
         * rows without one first, then each label where it first appears in
         * the department's table, rows in table order under it. */
        const dept_of = new Map();
        shown_depts.forEach((d) => {
            const cats = [];
            d.workspaces.forEach((w, i) => {
                if (dept_of.has(w)) return;
                const cat = d.categories?.[w] || "";
                if (cat && !cats.includes(cat)) cats.push(cat);
                dept_of.set(w, { label: __(d.name), cat, rank: (cats.indexOf(cat) + 1) * 1000 + i });
            });
        });
        const dept_labels = shown_depts.map((d) => __(d.name));
        /* one department with labels: the switcher already names it, so its
         * section drops the title; with no labels, or all shown, it keeps it */
        const untitled = new Set(D && !D.all
            ? shown_depts.filter((d) => Object.keys(d.categories || {}).length).map((d) => __(d.name))
            : []);
        const dept_allows = (ws) => {
            if (!D || !ws.public) return true;
            if (dept_of.has(ws.name)) return true;
            /* a department shows the rows it lists, not its workspaces' children */
            if (D.assigned.has(ws.name) || (ws.parent_page && D.assigned.has(ws.parent_page))) return false;
            return D.rest;
        };
        this.render_department_switcher(D);
        const group_for = () => GROUP_ORDER[0];
        const groups = {};
        const menu = this.sidebar_menu;
        const container_for = (ws) => {
            const label = group_for(ws);
            if (!groups[label]) {
                groups[label] = $(`
                    <div class="modern-sidebar-section${untitled.has(label) ? " tm-untitled" : ""}" data-group="${frappe.utils.escape_html(label)}">
                        <div class="modern-sidebar-section-title"><span>${frappe.utils.escape_html(label)}</span></div>
                        <div class="modern-sidebar-items workspace-items"></div>
                    </div>`);
                groups[label].appendTo(menu);
            }
            return groups[label].find(".workspace-items");
        };

        /* Status / error messages go into a plain holder that the groups sit before. */
        const workspace_container = $(`<div class="modern-sidebar-items workspace-status"></div>`).appendTo(this.sidebar_menu);

        // Skeleton rows until the list is in (only seen when boot has no pages)
        const loading = $(`
            <div class="modern-sidebar-skeleton" aria-busy="true">
                ${'<span></span>'.repeat(7)}
            </div>
        `).appendTo(workspace_container);

        // Helper function to safely check if a route matches
        const isRouteMatch = (routeArray, type, name) => {
            if (!Array.isArray(routeArray) || routeArray.length === 0) return false;

            if (routeArray[0] !== type) return false;

            // Handle private workspaces route format: workspace/private/name
            if (routeArray[1] === 'private') {
                return routeArray[2] === name;
            }

            // Handle standard route format: workspace/name
            return routeArray[1] === name;
        };

        // Use frappe.xcall to get workspace sidebar items. A refresh that
        // starts while this one is in flight wins (token); whatever groups
        // exist are rebuilt, never appended to.
        const token = (this._ws_token = (this._ws_token || 0) + 1);
        // After create / rename / delete the workspace view already holds
        // the updated list (workspace.js update_cached_values); a fetch
        // right then would race the server and show the old one. On first
        // draw boot.allowed_workspaces is the same list — no request at all.
        const source = pages
            ? Promise.resolve({ pages })
            : (frappe.boot?.allowed_workspaces?.length
                ? Promise.resolve({ pages: frappe.boot.allowed_workspaces })
                : frappe.xcall("frappe.desk.desktop.get_workspace_sidebar_items"));
        source
            .then(result => {
                // Clear loading indicator
                loading.remove();
                if (token !== this._ws_token) return;
                menu.children(".modern-sidebar-section[data-group]").remove();
                this._ws_signature = this.workspace_signature(result && result.pages);
                this._ws_pages = result && result.pages;

                if (!result || !result.pages || !result.pages.length) {
                    // console.log("No workspace pages found");
                    $(`<div class="text-muted text-center p-2">No workspaces available</div>`).appendTo(workspace_container);
                    return;
                }

                // Public workspaces plus the user's own private ones, less
                // what Theme Settings hides (a workspace row with Hide, a
                // whole group, or the My Workspaces section)
                const workspaces = result.pages.filter(page =>
                    (page.public === 1 || page.for_user === frappe.session.user)
                    && (!page.public || !page.is_hidden)
                    && !hidden_ws.has(page.name) && !hidden_ws.has(page.title)
                    && !hidden_groups.has(group_for(page))
                    && (show_mine || page.public === 1)
                    && dept_allows(page));
                const shown = new Set(workspaces.flatMap((w) => [w.name, w.title]).filter(Boolean));

                // Organize into parent and child items
                const parentItems = {};
                const childItems = {};

                // First, categorize items
                workspaces.forEach(workspace => {
                    /* A child given its own Group row in Theme Settings,
                     * listed itself in a department, or whose parent is
                     * hidden, stands on its own in its group. */
                    if (!workspace.parent_page || overrides[workspace.name] || (workspace.public && dept_of.has(workspace.name)) || !shown.has(workspace.parent_page)) {
                        // This is a parent item
                        parentItems[workspace.name] = workspace;
                    } else {
                        // This is a child item
                        if (!childItems[workspace.parent_page]) {
                            childItems[workspace.parent_page] = [];
                        }
                        childItems[workspace.parent_page].push(workspace);
                    }
                });

                const currentRoute = frappe.get_route() || [];
                const childrenOf = (workspace) => childItems[workspace.name] || childItems[workspace.title] || [];
                const isCurrent = (workspace) =>
                    isRouteMatch(currentRoute, 'workspace', workspace.name)
                    || isRouteMatch(currentRoute, 'Workspaces', workspace.name)
                    || localStorage.current_page === workspace.title;
                const branchIsCurrent = (workspace, seen = new Set()) => {
                    const key = workspace.name || workspace.title;
                    if (seen.has(key)) return false;
                    const next = new Set(seen).add(key);
                    return isCurrent(workspace) || childrenOf(workspace).some((child) => branchIsCurrent(child, next));
                };

                const bindTooltip = (item) => {
                    item.on('mouseenter', function () {
                        const tooltip = $(this).children('a').find('.sidebar-tooltip');
                        const itemRect = this.getBoundingClientRect();
                        tooltip.css({
                            'position': 'fixed',
                            'top': itemRect.top + (itemRect.height / 2) + 'px',
                            'transform': 'translateY(-50%)',
                            'opacity': '1',
                            'visibility': 'visible'
                        });
                    });
                    item.on('mouseleave', function () {
                        $(this).children('a').find('.sidebar-tooltip').css({ 'opacity': '0', 'visibility': 'hidden' });
                    });
                };

                const bindCollapsedPopover = (item, children_container) => {
                    item.on('mouseenter', function () {
                        if (!$('.modern-sidebar').hasClass('collapsed')) return;
                        const itemRect = this.getBoundingClientRect();
                        const windowHeight = window.innerHeight;
                        children_container.css({ position: 'fixed', visibility: 'visible', display: 'block' });
                        const submenuRect = children_container[0].getBoundingClientRect();
                        const arrowTargetPosition = itemRect.top + (itemRect.height / 2);
                        let topPosition = Math.max(10, arrowTargetPosition - 20);
                        if (topPosition + submenuRect.height > windowHeight - 10) {
                            topPosition = submenuRect.height < windowHeight - 20
                                ? windowHeight - submenuRect.height - 10
                                : 10;
                            if (submenuRect.height >= windowHeight - 20) {
                                children_container.css({ 'max-height': (windowHeight - 20) + 'px', 'overflow-y': 'auto' });
                            }
                        }
                        children_container.css({ top: topPosition + 'px' });
                        const maxArrowTop = Math.min(submenuRect.height - 10, windowHeight - topPosition - 20);
                        children_container.css('--arrow-top', Math.max(10, Math.min(arrowTargetPosition - topPosition, maxArrowTop)) + 'px');
                        children_container.addClass('submenu-visible');
                    });
                    item.on('mouseleave', function () {
                        if (!$('.modern-sidebar').hasClass('collapsed')) return;
                        setTimeout(() => {
                            if (!children_container.is(':hover')) {
                                children_container.removeClass('submenu-visible').removeAttr('style').css({ display: 'none' });
                            }
                        }, 200);
                    });
                    children_container.on('mouseleave', function () {
                        if (!$('.modern-sidebar').hasClass('collapsed')) return;
                        setTimeout(() => {
                            if (!item.is(':hover')) {
                                children_container.removeClass('submenu-visible').removeAttr('style').css({ display: 'none' });
                            }
                        }, 100);
                    });
                };

                const renderWorkspace = (workspace, container, depth = 0, ancestors = new Set()) => {
                    const key = workspace.name || workspace.title;
                    if (ancestors.has(key)) return;
                    const nextAncestors = new Set(ancestors).add(key);
                    const children = childrenOf(workspace).filter((child) => !nextAncestors.has(child.name || child.title));
                    const hasChildren = children.length > 0;
                    const expanded = hasChildren && children.some((child) => branchIsCurrent(child, nextAncestors));
                    const item = $(`
                        <div class="modern-sidebar-item${depth ? ' child-item' : ''}${isCurrent(workspace) ? ' active' : ''}${expanded ? ' has-active-child' : ''}${hasChildren ? ' has-children' : ''}">
                            <a href="/app/${workspace.public
                                ? frappe.router.slug(workspace.title)
                                : "private/" + frappe.router.slug(workspace.title)
                            }" title="${frappe.utils.escape_html(__(workspace.title))}">
                                <span class="sidebar-item-icon" item-icon="${frappe.utils.escape_html(workspace.icon || 'folder-normal')}">
                                    ${frappe.utils.icon(workspace.icon || (workspace.public ? 'folder-normal' : 'star'), 'md')}
                                </span>
                                <span class="sidebar-item-label">${frappe.utils.escape_html(__(workspace.title))}</span>
                                <span class="sidebar-tooltip">${frappe.utils.escape_html(__(workspace.title))}</span>
                                ${hasChildren ? `<span class="fa ${expanded ? 'fa-chevron-up' : 'fa-chevron-down'} toggle-children"></span>` : ''}
                            </a>
                        </div>`).appendTo(container);

                    if (!hasChildren) {
                        if (!depth) bindTooltip(item);
                        return;
                    }

                    const childrenContainer = $(`<div class="modern-sidebar-children${depth ? ' nested-children' : ''}"${expanded ? '' : ' style="display:none"'}></div>`).appendTo(container);
                    children.forEach((child) => renderWorkspace(child, childrenContainer, depth + 1, nextAncestors));
                    item.find('> a > .toggle-children').on('click', function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        $(this).toggleClass('fa-chevron-down fa-chevron-up');
                        childrenContainer.stop(true, true).slideToggle(200);
                    });
                    if (!depth) bindCollapsedPopover(item, childrenContainer);
                };

                Object.values(parentItems).forEach((workspace) => {
                    renderWorkspace(workspace, container_for(workspace));
                });

                // The items above were marked from localStorage.current_page
                // (the last workspace visited), which is stale when this
                // render lands after the route event. Resolve against the
                // route that is actually open now.
                this.update_active_items();
            })
            .catch(error => {
                // console.error("Error fetching workspace items:", error);
                loading.remove();
                $(`
                    <div class="text-muted text-center p-2">
                        Error loading workspaces. Please refresh the page.
                    </div>
                `).appendTo(workspace_container);
            });
    }

    /* The person's departments from boot (themate_department.boot_departments)
     * and which one is chosen: their preference, else the first. "All" shows
     * every one of theirs at once. null when they have none. */
    departments() {
        const data = frappe.boot?.themate?.departments || {};
        const list = data.list || [];
        if (!list.length) return null;
        const pick = frappe.boot?.themate?.user_prefs?.department;
        const all = pick === "All" && list.length > 1;
        return {
            list,
            all,
            current: all ? null : (list.find((d) => d.name === pick) || list[0]),
            assigned: new Set(data.assigned || []),
            rest: frappe.boot?.themate?.sidebar_outside_departments !== "Hide",
        };
    }

    /* The switcher at the top of the menu, for someone with two or more
     * departments. Its menu is a popover on <body>, so the rail's narrow,
     * scrolling sidebar never clips it. */
    render_department_switcher(D) {
        this.sidebar.find(".tm-dept").remove();
        this.close_department_menu();
        if (!D || D.list.length < 2) return;
        const esc = frappe.utils.escape_html;
        const name = D.all ? __("All departments") : __(D.current.name);
        const icon = D.all ? "list" : (D.current.icon || "organization");
        const color = D.all ? "" : (D.current.color || "");
        const box = $(`
            <div class="tm-dept">
                <button type="button" class="btn-reset tm-dept__btn" aria-haspopup="menu" aria-expanded="false" title="${esc(name)}">
                    <span class="tm-dept__icon"${color ? ` style="--tm-dept-c: ${esc(color)}"` : ""}>${frappe.utils.icon(icon, "md")}</span>
                    <span class="tm-dept__text">
                        <span class="tm-dept__kicker">${__("Department")}</span>
                        <span class="tm-dept__name">${esc(name)}</span>
                    </span>
                    <span class="tm-dept__chev">${frappe.utils.icon("select", "sm")}</span>
                </button>
            </div>`);
        box.insertBefore(this.sidebar_menu);
        box.find(".tm-dept__btn").on("click", (e) => {
            e.stopPropagation();
            this._dept_menu ? this.close_department_menu() : this.open_department_menu(D, e.currentTarget);
        });
    }

    open_department_menu(D, btn) {
        const esc = frappe.utils.escape_html;
        const allowed = new Set((this._ws_pages || frappe.boot?.allowed_workspaces || []).map((p) => p.name));
        const check = `<span class="tm-dept-menu__check">${frappe.utils.icon("check", "sm")}</span>`;
        const row = (key, label, icon, color, count, on) => `
            <button type="button" class="btn-reset tm-dept-menu__item${on ? " is-on" : ""}" role="menuitemradio" aria-checked="${on}" data-dept="${esc(key)}">
                <span class="tm-dept__icon"${color ? ` style="--tm-dept-c: ${esc(color)}"` : ""}>${frappe.utils.icon(icon, "sm")}</span>
                <span class="tm-dept-menu__name">${esc(label)}</span>
                ${count === null ? "" : `<span class="tm-dept-menu__count">${count}</span>`}
                ${check}
            </button>`;
        const rows = D.list.map((d) => row(
            d.name, __(d.name), d.icon || "organization", d.color,
            d.workspaces.filter((w) => allowed.has(w)).length,
            !D.all && d === D.current,
        )).join("");
        const menu = $(`
            <div class="tm-dept-menu" role="menu" aria-label="${esc(__("Switch department"))}">
                <div class="tm-dept-menu__title">${__("Switch department")}</div>
                ${rows}
                <div class="tm-dept-menu__rule" role="separator"></div>
                ${row("All", __("All departments"), "list", "", null, D.all)}
            </div>`).appendTo(document.body);
        this._dept_menu = menu;
        $(btn).attr("aria-expanded", "true");

        /* beside the rail, under the button when the sidebar is open */
        const r = btn.getBoundingClientRect();
        const rtl = document.documentElement.dir === "rtl";
        const rail = this.sidebar.hasClass("collapsed");
        const css = rail
            ? { top: r.top, [rtl ? "right" : "left"]: rtl ? innerWidth - r.left + 8 : r.right + 8 }
            : { top: r.bottom + 6, [rtl ? "right" : "left"]: rtl ? innerWidth - r.right : r.left, minWidth: r.width };
        menu.css(css);
        const room = innerHeight - menu[0].getBoundingClientRect().bottom - 8;
        if (room < 0) menu.css("top", Math.max(8, (rail ? r.top : r.bottom + 6) + room));

        const items = menu.find(".tm-dept-menu__item");
        (items.filter(".is-on")[0] || items[0]).focus();
        items.on("click", (e) => this.choose_department(e.currentTarget.dataset.dept));
        menu.on("keydown", (e) => {
            const i = items.index(document.activeElement);
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                items.eq((i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length).trigger("focus");
            } else if (e.key === "Escape" || e.key === "Tab") {
                e.preventDefault();
                this.close_department_menu(true);
            }
        });
        this._dept_away = (e) => {
            if (!menu[0].contains(e.target)) this.close_department_menu();
        };
        setTimeout(() => {
            document.addEventListener("pointerdown", this._dept_away, true);
            window.addEventListener("resize", this._dept_away);
        });
    }

    close_department_menu(refocus) {
        if (!this._dept_menu) return;
        this._dept_menu.remove();
        this._dept_menu = null;
        document.removeEventListener("pointerdown", this._dept_away, true);
        window.removeEventListener("resize", this._dept_away);
        const btn = this.sidebar.find(".tm-dept__btn").attr("aria-expanded", "false");
        if (refocus) btn.trigger("focus");
    }

    /* Kept as the person's preference (Themate User Preference > Department);
     * on a workspace, the department's own opening workspace follows. */
    choose_department(key) {
        this.close_department_menu();
        const prefs = (frappe.boot.themate.user_prefs = frappe.boot.themate.user_prefs || {});
        if (prefs.department === key || (!prefs.department && key === this.departments()?.list[0]?.name)) return;
        prefs.department = key;
        frappe.call({ method: "themate.api.save_pref", args: { key: "department", value: JSON.stringify(key) }, no_spinner: true });
        this.sidebar_menu.children(".modern-sidebar-section[data-group], .workspace-status").remove();
        this.setup_workspace_menu(this._ws_pages);

        const D = this.departments();
        const on_workspace = /^workspaces?$/i.test(frappe.get_route()?.[0] || "");
        if (!D || D.all || !on_workspace) return;
        const pages = this._ws_pages || frappe.boot?.allowed_workspaces || [];
        const target = [D.current.default_workspace, ...D.current.workspaces]
            .map((n) => pages.find((p) => p.name === n))
            .find(Boolean);
        if (target) frappe.set_route(frappe.router.slug(target.title));
    }

    /* Rebuild the workspace groups (after a workspace is created, renamed
     * or deleted — js/workspace/tabs.js hooks Frappe's make_sidebar). */
    refresh_workspaces(pages) {
        /* Frappe's workspace view calls make_sidebar on its FIRST render too,
         * with the same list boot already drew from — rebuilding then threw
         * the whole menu away and drew it again half a second into every
         * page load. Only a list that actually changed is redrawn. */
        const signature = this.workspace_signature(pages || frappe.boot?.allowed_workspaces);
        if (signature && signature === this._ws_signature && this.sidebar_menu.children(".modern-sidebar-section[data-group]").length) {
            this.update_active_items();
            return;
        }
        this.sidebar_menu.children(".modern-sidebar-section[data-group], .workspace-status").remove();
        this.setup_workspace_menu(pages);
        setTimeout(() => this.update_active_items(), pages ? 50 : 600);
    }

    /* what the menu is drawn from: which pages, their titles, icons, nesting
     * and visibility, in order */
    workspace_signature(pages) {
        if (!Array.isArray(pages) || !pages.length) return null;
        return JSON.stringify(pages.map((p) => [p.name, p.title, p.icon, p.parent_page, p.public, p.for_user, p.is_hidden, p.indicator_color]));
    }

    setup_modules_menu() {
        // Create modules section
        const modules_section = $(`
        <div class="modern-sidebar-section">
            <div class="modern-sidebar-section-title">
                <span>Modules</span>
            </div>
            <div class="modern-sidebar-items module-items"></div>
        </div>
    `).appendTo(this.sidebar_menu);

        // Get modules directly from boot info
        const modules = frappe.boot.allowed_modules || [];
        const module_container = modules_section.find('.module-items');

        modules.forEach(module => {
            const route = frappe.get_route() || [];
            const is_active = (route[0] === 'modules' || route[0] === 'module') &&
                route[1] === module.name;

            $(`
            <div class="modern-sidebar-item ${is_active ? 'active' : ''}">
                <a href="#modules/${module.name}">
                    <i class="${module.icon || 'fa fa-cube'}"></i>
                    <span class="sidebar-item-label">${module.label || module.name}</span>
                </a>
            </div>
        `).appendTo(module_container);
        });
    }


    bind_events() {
        // Update active workspace/module when route changes
        frappe.router.on('change', () => {
            this.update_active_items();
        });

        // The breadcrumb workspace is resolved by the view, after 'change'.
        // Wrap update() once so the sidebar follows it; everything else about
        // breadcrumbs is untouched.
        if (frappe.breadcrumbs && !frappe.breadcrumbs._themate_wrapped) {
            const original = frappe.breadcrumbs.update;
            const sidebar = this;
            frappe.breadcrumbs.update = function () {
                const out = original.apply(this, arguments);
                sidebar.update_active_items();
                return out;
            };
            frappe.breadcrumbs._themate_wrapped = true;
        }

        // Handle report issue click
        this.sidebar_menu.find('#report-issue').on('click', (e) => {
            e.preventDefault();
            this.show_report_issue_dialog();
        });

        this.sidebar_menu.find('.modern-sidebar-item').on('click', () => {

            this.update_active_items();
        });
    }

    update_active_items() {
        // Remove active class from all items
        this.sidebar_menu.find('.modern-sidebar-item.active').removeClass('active');
        this.sidebar_menu.find('.modern-sidebar-item.has-active-child').removeClass('has-active-child');

        const route = frappe.get_route() || [];
        if (!route.length) return;

        // Which workspace does this route belong to?
        //  - a workspace page: itself.
        //  - anything else (List/Form/Report/page): the workspace Frappe's own
        //    breadcrumbs resolved for it (frappe.breadcrumbs.set_workspace:
        //    preferred module -> meta.module -> module_wise_workspaces). That
        //    is the link shown left of the doctype in the navbar, so the
        //    sidebar and the breadcrumb always agree.
        //  - failing that, the last workspace the user was on
        //    (localStorage.current_page, written by Frappe's workspace view).
        // Breadcrumbs are set by the view AFTER the router 'change' event, so
        // bind_events re-runs this once they land.
        let target;
        if (route[0] === 'workspace' || route[0] === 'Workspaces') {
            target = route[1] === 'private' ? route[2] : route[1];
        } else {
            const crumbs = frappe.breadcrumbs && frappe.breadcrumbs.all;
            target = (crumbs && crumbs[frappe.get_route_str()] || {}).workspace
                || localStorage.current_page;
        }
        if (!target) return;

        const slug = frappe.router.slug(target);
        const $item = this.sidebar_menu
            .find(`.workspace-items .modern-sidebar-item a[href="/app/${slug}"], ` +
                  `.workspace-items .modern-sidebar-item a[href="/app/private/${slug}"]`)
            .first()
            .closest('.modern-sidebar-item');
        if (!$item.length) return;

        $item.addClass('active');

        // A child workspace: reveal its group and mark the parent so the rail
        // (collapsed mode, children hidden) still shows where you are.
        if ($item.hasClass('child-item')) {
            const $children = $item.closest('.modern-sidebar-children');
            $children.css('display', '');
            $children.prev('.modern-sidebar-item.has-children')
                .addClass('has-active-child')
                .find('.toggle-children').removeClass('fa-chevron-down').addClass('fa-chevron-up');
        }

        // The page-head icon box and the form overview mirror this item
        // (core/page_head.js, core/form_overview.js).
        window.themate?.placePageIcon?.();
        window.themate?.refreshOverview?.();
    }

    show_report_issue_dialog() {
        const d = new frappe.ui.Dialog({
            title: __('Report Issue'),
            fields: [
                {
                    fieldtype: 'Text',
                    label: __('Issue Description'),
                    fieldname: 'issue_description',
                    reqd: 1
                }
            ],
            primary_action_label: __('Submit'),
            primary_action: (values) => {
                frappe.call({
                    method: 'frappe.desk.reportview.report_issue',
                    args: {
                        issue: values.issue_description,
                        url: window.location.href
                    },
                    callback: function (r) {
                        if (r.message) {
                            frappe.msgprint({
                                title: __('Issue Reported'),
                                message: __('Thank you for reporting this issue. Your issue has been logged.'),
                                indicator: 'green'
                            });
                        }
                        d.hide();
                    }
                });
            }
        });
        d.show();
    }

    apply_responsive_behavior() {
        // Handle responsive behavior based on window resize
        $(window).on('resize', () => {
            if ($(window).width() < 992) {
                this.sidebar.addClass('collapsed');
            }
            this.sync_collapsed_state();
        });

        // Initial check
        if ($(window).width() < 992) {
            this.sidebar.addClass('collapsed');
        }
        this.sync_collapsed_state();
    }
};

// Override Frappe's standard sidebar with our modern sidebar — unless the
// master switch is off (core/bootstrap.js): then Frappe's own class stays.
if (document.documentElement.dataset.tmEnabled !== "off") {
    frappe.ui.Sidebar = frappe.ui.ModernSidebar;
}

// Initialize when document is ready
$(document).ready(function () {
    // Disable standard sidebar initializations
    if (frappe.router) {
        frappe.router.on('change', function () {
            // This hook will be triggered when route changes
            // Ensure our modern sidebar is responsive to route changes
            if (frappe.desk && frappe.desk.sidebar) {
                frappe.desk.sidebar.update_active_items();
            }
        });
    }
});
