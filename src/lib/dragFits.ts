// What a drag can land on. Browsers let a page read a drag's contents only
// on drop, but its types are visible throughout, so each drag carries one
// empty type per kind of control its action works on: a key, a dial.
export function markFits(data: DataTransfer, controllers: string[]) {
	for (const c of controllers) data.setData("ectodeck-fits-" + c.toLowerCase(), "");
}

export function fits(data: DataTransfer, controller: string): boolean {
	const marked = Array.from(data.types).filter((t) => t.startsWith("ectodeck-fits-"));
	return marked.length == 0 || marked.includes("ectodeck-fits-" + controller.toLowerCase());
}
