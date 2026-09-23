<script lang="ts">
	import type { DeviceInfo } from "$lib/DeviceInfo";
	import type { Profile } from "$lib/Profile";

	import Copy from "phosphor-svelte/lib/Copy";
	import FolderSimple from "phosphor-svelte/lib/FolderSimple";
	import Gear from "phosphor-svelte/lib/Gear";
	import PencilSimple from "phosphor-svelte/lib/PencilSimple";
	import Plus from "phosphor-svelte/lib/Plus";
	import Trash from "phosphor-svelte/lib/Trash";
	import X from "phosphor-svelte/lib/X";
	import ChoiceMenu, { type ChoiceSection } from "./ChoiceMenu.svelte";
	import Dialog from "./Dialog.svelte";
	import { tick } from "svelte";

	import { t } from "$lib/i18n";
	import { inspectedInstance } from "$lib/propertyInspector";

	import { invoke } from "@tauri-apps/api/core";
	import { listen } from "@tauri-apps/api/event";
	import { message } from "@tauri-apps/plugin-dialog";

	let folders: { [name: string]: string[] } = {};
	let value: string;
	async function getProfiles(device: DeviceInfo) {
		let profiles: string[] = await invoke("get_profiles", { device: device.id });
		folders = {};
		for (const id of profiles) {
			let folder = id.includes("/") ? id.split("/")[0] : "";
			if (folders[folder]) folders[folder].push(id);
			else folders[folder] = [id];
		}
		profile = await invoke("get_selected_profile", { device: device.id });
		value = profile.id;
		oldValue = value;
	}

	export let device: DeviceInfo;
	getProfiles(device);

	export let profile: Profile;
	export async function setProfile(id: string) {
		if (!device || !id) return;
		if (value != id) {
			value = id;
			return;
		}
		await invoke("set_selected_profile", { device: device.id, id });
		profile = await invoke("get_selected_profile", { device: device.id });

		let folder = id.includes("/") ? id.split("/")[0] : "";
		if (folders[folder]) {
			if (!folders[folder].includes(id)) folders[folder].push(id);
		} else folders[folder] = [id];
		folders = folders;

		$inspectedInstance = null;
	}

	listen("rerender_images", async () => {
		try {
			profile = await invoke("get_selected_profile", { device: device.id });
		} catch {}
	});

	async function deleteProfile(id: string) {
		for (const devices of Object.values(applicationProfiles)) {
			if (devices[device.id] == id) {
				delete devices[device.id];
				applicationProfiles = applicationProfiles;
			}
		}
		await invoke("delete_profile", { device: device.id, profile: id });
		let folder = id.includes("/") ? id.split("/")[0] : "";
		folders[folder].splice(folders[folder].indexOf(id), 1);
		folders = folders;
	}

	let renamingProfile: string | null = null;
	let renameInput: HTMLInputElement;
	let newId: string = "";

	async function saveRenamedProfile(oldId: string) {
		if (!renameInput.checkValidity() || !newId) return;
		if (newId == oldId) {
			renamingProfile = null;
			return;
		}

		// Check if a profile with the new ID already exists
		const allProfiles = Object.values(folders).flat();
		if (allProfiles.includes(newId)) {
			message($t("profile_manager.rename.exists", { id: newId }), { title: $t("profile_manager.rename.failed"), buttons: { ok: $t("dialog.ok") } });
			return;
		}

		try {
			await invoke("rename_profile", { device: device.id, oldId, newId, retain: false });
		} catch (error: any) {
			message(error, { title: $t("profile_manager.rename.failed"), buttons: { ok: $t("dialog.ok") } });
			console.error(error);
		}

		// Update application profile mappings
		for (const devices of Object.values(applicationProfiles)) {
			if (devices[device.id] == oldId) devices[device.id] = newId;
		}
		applicationProfiles = applicationProfiles;

		// Update folders structure
		const oldFolder = oldId.includes("/") ? oldId.split("/")[0] : "";
		const newFolder = newId.includes("/") ? newId.split("/")[0] : "";

		// Remove from old folder
		if (folders[oldFolder]) {
			const index = folders[oldFolder].indexOf(oldId);
			if (index != -1) {
				folders[oldFolder].splice(index, 1);
				if (folders[oldFolder].length == 0 && oldFolder != "") delete folders[oldFolder];
			}
		}

		// Add to new folder
		if (folders[newFolder]) folders[newFolder].push(newId);
		else folders[newFolder] = [newId];

		folders = folders;
		renamingProfile = null;
	}
	$: if (renameInput) renameInput.focus();

	async function duplicateProfile(id: string) {
		let newId = id + $t("profile_manager.duplicate.suffix");

		// Check if a profile with the new ID already exists
		const allProfiles = Object.values(folders).flat();
		let counter = 1;
		while (allProfiles.includes(newId)) {
			counter++;
			newId = `${id}${$t("profile_manager.duplicate.suffix")} ${counter}`;
		}

		await invoke("rename_profile", { device: device.id, oldId: id, newId, retain: true });
		await getProfiles(device);
	}

	let oldValue: string;
	$: {
		if (value == "opendeck_edit_profiles") {
			if (oldValue) showPopup = true;
			value = oldValue;
		} else if (value && value != oldValue && (!profile || profile.id != value)) {
			setProfile(value);
			oldValue = value;
		}
	}

	let showPopup: boolean = false;
	let nameInput: HTMLInputElement;

	let applications: string[];
	let applicationProfiles: { [appName: string]: { [device: string]: string } };
	(async () => {
		applications = await invoke("get_applications");
		applicationProfiles = await invoke("get_application_profiles");
	})();
	listen("applications", ({ payload }: { payload: string[] }) => (applications = payload));
	$: {
		if (applicationProfiles) {
			applicationProfiles = Object.fromEntries(
				Object.entries(applicationProfiles).filter(([_, devices]) => Object.values(devices).filter((v) => v).length != 0),
			);
			invoke("set_application_profiles", { value: applicationProfiles });
		}
	}

	// Names are kept to letters, numbers, spaces and underscores; a slash puts
	// a profile in a folder.
	const NAME = /^[a-zA-Z0-9_ ]+(\/[a-zA-Z0-9_ ]+)?$/;
	const FOLDER = /^[a-zA-Z0-9_ ]+$/;
	// Default first, then by name, with numbers in number order ("2" before "10").
	const byName = (a: string, b: string) => (a == "Default" ? -1 : b == "Default" ? 1 : a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
	const leaf = (id: string) => (id.includes("/") ? id.split("/")[1] : id);

	$: menuSections = [
		{ heading: $t("profile_manager.menu_heading"), items: (folders[""] ?? []).slice().sort(byName).map((id) => ({ id, label: id, selected: id == value })) },
		...Object.entries(folders)
			.filter(([folder, ids]) => folder && ids.length)
			.sort(([a], [b]) => byName(a, b))
			.map(([folder, ids]) => ({
				heading: folder,
				headingIcon: FolderSimple,
				items: ids.slice().sort(byName).map((id) => ({ id, label: leaf(id), selected: id == value, indent: true })),
			})),
		{
			items: [
				{ id: "opendeck_new_profile", label: $t("profile_manager.new"), command: true, icon: Plus },
				{ id: "opendeck_edit_profiles", label: $t("profile_manager.manage"), command: true, icon: Gear },
			],
		},
	] as ChoiceSection[];

	function chooseFromMenu(id: string) {
		if (id == "opendeck_edit_profiles") showPopup = true;
		else if (id == "opendeck_new_profile") {
			startCreating("profile");
			fromMenu = true;
		}
		else value = id;
	}

	// Creating a profile or a folder happens in a field at the top of the list.
	let creating: "profile" | "folder" | null = null;
	// started from the profile menu rather than inside this window
	let fromMenu = false;
	let createName = "";
	let createInput: HTMLInputElement;
	function startCreating(kind: "profile" | "folder") {
		showPopup = true;
		fromMenu = false;
		creating = kind;
		createName = "";
	}
	// after the dialog has opened and placed its own focus
	$: if (createInput) tick().then(() => tick()).then(() => createInput?.focus());
	$: createValid = creating == "folder" ? FOLDER.test(createName.trim()) : NAME.test(createName.trim());
	async function create() {
		const name = createName.trim();
		if (!createValid) return;
		// a folder needs a profile to exist; it starts with one you can rename
		const id = creating == "folder" ? `${name}/${$t("profile_manager.first_in_folder")}` : name;
		await setProfile(id);
		value = id;
		creating = null;
		if (fromMenu) showPopup = false;
	}
	$: renameValid = NAME.test(newId.trim());

	// The profiles an application can switch to, for the menus in "Switch automatically".
	function profileChoices(selected: string | undefined, allowNone: boolean) {
		return [
			...(allowNone ? [{ items: [{ id: "", label: $t("profile_manager.no_switch"), selected: !selected }] }] : []),
			{ items: (folders[""] ?? []).slice().sort(byName).map((id) => ({ id, label: id, selected: id == selected })) },
			...Object.entries(folders)
				.filter(([folder, ids]) => folder && ids.length)
				.sort(([a], [b]) => byName(a, b))
				.map(([folder, ids]) => ({ heading: folder, headingIcon: FolderSimple, items: ids.slice().sort(byName).map((id) => ({ id, label: leaf(id), selected: id == selected, indent: true })) })),
		] as ChoiceSection[];
	}
	function setAppProfile(appName: string, id: string) {
		applicationProfiles[appName] ||= {};
		if (id) applicationProfiles[appName][device.id] = id;
		else delete applicationProfiles[appName][device.id];
		applicationProfiles = applicationProfiles;
	}
	$: appRules = applicationProfiles
		? Object.entries(applicationProfiles)
				.filter(([appName, devices]) => appName != "opendeck_default" && devices[device.id])
				.sort((a, b) => a[0].localeCompare(b[0]))
		: [];
	$: addAppSections = [
		{
			heading: $t("profile_manager.running_apps"),
			items: (applications ?? []).filter((appName) => !applicationProfiles?.[appName]?.[device.id]).map((appName) => ({ id: appName, label: appName, command: true })),
		},
	] as ChoiceSection[];
</script>

<div class="flex flex-row items-center">
<span class="text-neutral-600 text-[15px] px-[3px]" aria-hidden="true">/</span>
<ChoiceMenu variant="crumb" label={$t("profile_manager.label")} current={value ? leaf(value) : ""} sections={menuSections} on:choose={(e) => chooseFromMenu(e.detail)} />
</div>

<Dialog bind:show={showPopup} title={$t("profile_manager.profiles")} subtitle={$t("profile_manager.on_device", { name: device.name })}>
	<div class="flex flex-row gap-1.5 mb-1.5">
		<button class="btn" on:click={() => startCreating("profile")}><Plus size="14" />{$t("profile_manager.new")}</button>
		<button class="btn" on:click={() => startCreating("folder")}><FolderSimple size="14" />{$t("profile_manager.new_folder")}</button>
	</div>

	{#if creating}
		<form class="px-2.5 pt-1 pb-2" on:submit|preventDefault={create}>
			<div class="flex flex-row gap-1.5">
				<input
					bind:this={createInput}
					bind:value={createName}
					class="field flex-1"
					class:invalid={createName && !createValid}
					placeholder={creating == "folder" ? $t("profile_manager.folder_placeholder") : $t("profile_manager.create.placeholder")}
					aria-label={creating == "folder" ? $t("profile_manager.new_folder") : $t("profile_manager.create.label")}
					on:keydown={(e) => {
						if (e.key == "Escape") {
							e.stopPropagation();
							creating = null;
						}
					}}
				/>
				<button type="submit" class="btn primary" disabled={!createValid}>{$t("profile_manager.create")}</button>
				<button type="button" class="btn quiet" on:click={() => (creating = null)}>{$t("device_view.animation.cancel")}</button>
			</div>
			<p class="mt-1.5 text-xs" class:text-red-400={createName && !createValid} class:text-neutral-500={!createName || createValid}>
				{creating == "folder" ? $t("profile_manager.folder_rule") : $t("profile_manager.name_rule")}
			</p>
		</form>
	{/if}

	<div role="list">
		{#each Object.entries(folders).sort(([a], [b]) => (a == "" ? -1 : b == "" ? 1 : byName(a, b))) as [folder, profiles]}
			{#if folder && profiles.length}
				<div class="flex flex-row items-center gap-2.5 h-[38px] px-2.5 text-neutral-200 font-medium">
					<FolderSimple size="15" class="text-neutral-400" />{folder}
				</div>
			{/if}
			{#each profiles.slice().sort(byName) as id}
				{#if id == renamingProfile}
					<div class="py-1 pr-2.5" class:pl-[34px]={folder} class:pl-2.5={!folder}>
						<div class="flex flex-row gap-1.5">
							<input
								bind:this={renameInput}
								bind:value={newId}
								class="field flex-1"
								class:invalid={!renameValid}
								aria-label={$t("profile_manager.rename")}
								on:keydown={(e) => {
									if (e.key == "Enter") saveRenamedProfile(id);
									else if (e.key == "Escape") {
										e.stopPropagation();
										renamingProfile = null;
									}
								}}
							/>
							<button class="btn primary" disabled={!renameValid} on:click={() => saveRenamedProfile(id)}>{$t("profile_manager.save")}</button>
						</div>
						<p class="mt-1.5 text-xs" class:text-red-400={!renameValid} class:text-neutral-500={renameValid}>{$t("profile_manager.name_rule")}</p>
					</div>
				{:else}
					<div class="group flex flex-row items-center gap-2.5 h-[38px] pr-2.5 rounded-[7px] hover:bg-neutral-750" class:pl-[34px]={folder} class:pl-2.5={!folder} role="listitem">
						<button class="flex-1 min-w-0 flex flex-row items-center gap-2.5 h-full text-left" on:click={() => (value = id)}>
							<span class="truncate font-medium text-neutral-200">{leaf(id)}</span>
							{#if id == value}<span class="text-[11px] text-neutral-400 border border-neutral-600 rounded-full px-[7px] py-px">{$t("profile_manager.in_use")}</span>{/if}
						</button>
						<div class="flex flex-row gap-0.5 text-xs text-neutral-500 group-hover:text-neutral-300 focus-within:text-neutral-300">
							{#if id != value}
								<button class="row-act" on:click={() => (renamingProfile = newId = id)}><PencilSimple size="13" />{$t("profile_manager.rename")}</button>
							{/if}
							<button class="row-act" on:click={() => duplicateProfile(id)}><Copy size="13" />{$t("profile_manager.duplicate")}</button>
							{#if id != value}
								<button class="row-act text-red-400!" on:click={() => deleteProfile(id)}><Trash size="13" />{$t("profile_manager.delete")}</button>
							{/if}
						</div>
					</div>
				{/if}
			{/each}
		{/each}
	</div>

	{#if applicationProfiles}
		<div class="mt-2 pt-3 border-t border-neutral-750">
			<h4 class="mb-1 text-xs font-semibold text-neutral-400">{$t("profile_manager.application_profiles")}</h4>
			<p class="mb-2 text-xs text-neutral-500">{$t("profile_manager.application_profiles.hint.3")}</p>
			{#each appRules as [appName, devices]}
				<div class="flex flex-row items-center gap-2.5 min-h-8">
					<span class="w-40 truncate text-neutral-300">{appName}</span>
					<span class="text-neutral-500">{$t("profile_manager.uses")}</span>
					<div class="w-44"><ChoiceMenu variant="field" label={appName} current={leaf(devices[device.id])} sections={profileChoices(devices[device.id], false)} on:choose={(e) => setAppProfile(appName, e.detail)} /></div>
					<button class="row-act ml-auto" on:click={() => setAppProfile(appName, "")} aria-label={$t("profile_manager.remove_application")}><X size="13" /></button>
				</div>
			{/each}
			<div class="flex flex-row items-center gap-2.5 min-h-8">
				<span class="w-40 truncate text-neutral-300">{$t("profile_manager.everything_else")}</span>
				<span class="text-neutral-500">{$t("profile_manager.uses")}</span>
				<div class="w-44">
					<ChoiceMenu
						variant="field"
						label={$t("profile_manager.default_profile")}
						current={applicationProfiles["opendeck_default"]?.[device.id] ? leaf(applicationProfiles["opendeck_default"][device.id]) : $t("profile_manager.no_switch")}
						sections={profileChoices(applicationProfiles["opendeck_default"]?.[device.id], true)}
						on:choose={(e) => setAppProfile("opendeck_default", e.detail)}
					/>
				</div>
				<div class="ml-auto">
					<ChoiceMenu label={$t("profile_manager.add_app")} current={$t("profile_manager.add_app")} sections={addAppSections} on:choose={(e) => setAppProfile(e.detail, value)} />
				</div>
			</div>
			<p class="mt-1.5 text-xs text-neutral-500">{$t("profile_manager.application_profiles.hint.1")}</p>
		</div>
	{/if}
</Dialog>
