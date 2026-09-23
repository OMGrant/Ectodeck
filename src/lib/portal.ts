// Moves an element to another place in the page, for overlays declared deep
// inside the title bar or a key that must cover the app body instead.
export function portal(node: HTMLElement, target: string = "#overlay-host") {
	const host = document.querySelector(target) ?? document.body;
	host.appendChild(node);
	return {
		destroy() {
			node.remove();
		},
	};
}
