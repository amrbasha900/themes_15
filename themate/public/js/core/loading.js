/* Placeholders that never flash.
 *
 * The rule this file enforces: a placeholder is only worth drawing for a wait
 * the person can actually feel. Anything that resolves inside a fifth of a
 * second should show nothing at all — a skeleton that appears for 80ms and
 * vanishes is itself a flicker, the same defect as a wrong tab painting
 * before the right one, and on a desk where Frappe keeps visited pages in the
 * DOM most navigation IS that fast. Drawing a curtain over it makes a fast
 * app feel slow and costs a layout pass for nothing.
 *
 *   themate.pending({ show, hide })  ->  { done(), cancel() }
 *
 *   DELAY  nothing is drawn before this; if done() lands first, `show` is
 *          never called and there is no paint at all.
 *   FLOOR  once drawn, it stays at least this long, so an answer arriving a
 *          few milliseconds later does not strobe.
 *
 * FLOOR is deliberately short. The usual advice is to hold a loader for half
 * a second, but that delays REAL CONTENT by up to half a second to smooth an
 * animation — a bad trade on a working screen. 150ms is enough to read as
 * deliberate rather than as a glitch, and it is the longest anything here
 * will ever hold content back.
 *
 * Either callback may throw without breaking the caller: a placeholder is
 * never the reason a screen fails to render. */

const DELAY = 200;
const FLOOR = 150;

function safely(fn) {
	try {
		fn?.();
	} catch (e) {
		/* a placeholder is decoration; never let it take the screen down */
	}
}

export function pending({ show, hide }) {
	let shown = 0;
	let settled = false;
	let timer = setTimeout(() => {
		timer = null;
		shown = Date.now();
		safely(show);
	}, DELAY);

	function finish() {
		if (settled) return;
		settled = true;
		if (timer) {
			/* fast enough that nothing was ever drawn */
			clearTimeout(timer);
			timer = null;
			return;
		}
		const held = Date.now() - shown;
		if (held >= FLOOR) safely(hide);
		else setTimeout(() => safely(hide), FLOOR - held);
	}

	return {
		done: finish,
		/* the wait was abandoned (the person routed away): drop the
		 * placeholder now, with no floor to honour */
		cancel() {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			else safely(hide);
			timer = null;
		},
	};
}

window.themate = window.themate || {};
window.themate.pending = pending;
