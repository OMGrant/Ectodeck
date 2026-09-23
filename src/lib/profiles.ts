import { writable } from "svelte/store";

// The selected deck's profiles, in the order they are shown: Default first,
// then by name. The profile manager keeps it; the page tabs read it.
export const profileIds = writable<string[]>([]);

// Default first, then by name, with numbers in number order ("2" before "10").
export const byName = (a: string, b: string) =>
	a == "Default" ? -1 : b == "Default" ? 1 : a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

// a profile's own name, without the folder it sits in
export const leaf = (id: string) => (id.includes("/") ? id.split("/")[1] : id);
