/* The splash leaves softly (templates/includes/splash_screen.html).
 *
 * Frappe removes `.splash` in one step when the desk is ready (desk.js
 * make_page_container), which reads as a blink. When that happens a copy is
 * put back over the page and faded out; nothing waits on it, it never holds
 * the desk back, and with reduced motion it is simply gone. */
(function () {
	const splash = document.querySelector(".tm-splash");
	if (!splash || !window.MutationObserver) return;
	const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
	const copy = splash.cloneNode(true);
	copy.classList.remove("splash");
	copy.classList.add("is-leaving"); /* holds still while it fades: no second entrance */
	copy.removeAttribute("role");
	const observer = new MutationObserver(() => {
		if (splash.isConnected) return;
		observer.disconnect();
		if (reduced) return;
		document.body.appendChild(copy);
		requestAnimationFrame(() => requestAnimationFrame(() => copy.classList.add("is-out")));
		const done = () => copy.remove();
		copy.addEventListener("transitionend", done, { once: true });
		setTimeout(done, 600); /* if the transition never runs */
	});
	observer.observe(splash.parentNode || document.body, { childList: true });
})();
