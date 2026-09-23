# <img src="src-tauri/icons/mark.svg" alt="" width="40" align="top"> Ectodeck

Ectodeck is an enhanced fork of [OpenDeck](https://github.com/nekename/OpenDeck) for the VSDinside MagTran M3.

OpenDeck is built around Elgato's hardware: a grid of separate keys, with any dials along the bottom. Some decks are built differently. The VSDinside MagTran M3 has transparent keys over a single display, and its dials run down the right side. Ectodeck adds what those decks need and leaves everything else as OpenDeck has it. That includes Elgato hardware, which works exactly as it does in OpenDeck, and support for plugins made for the Stream Deck SDK.

## What Ectodeck adds

- **A display behind the keys.** A deck can declare that its keys sit over one display. Ectodeck then draws the device view as that display, with the keys placed where they physically are, and gives you a background picker for the whole display.
- **Key backgrounds on or off.** On those decks, each key can sit on its own black square or float straight on the background. With the background off, a flat square painted into an icon is removed too.
- **Rounded keys** on those decks, on the hardware and in the device view.
- **Dials on the side.** A deck can declare that its dials run down the right. Ectodeck draws them there, lined up with the key grid.
- **Vector icons.** OpenDeck's own icons (Multi Action, Toggle Action and the status overlays) are redrawn as SVG, so they stay sharp at any size and have no background of their own.
- **Animated backgrounds** on those decks, drawn live and reacting to the keys and dials. Scenes: Aquarium (press a key to feed the fish, twice to tap the glass), Birds, Sky, Synthwave and Warp. Abstract: Aurora, Blob, Ember, Ink, Lava Lamp and Nebula. Music: Milkdrop and Spectrum, which listen to what the computer is playing (the speakers' output, never the microphone, and only while one of them is showing). The **Background Preset** action (put it on a key or a dial) changes a background's preset: Milkdrop's presets, the time of day in Aquarium, Birds and Sky, colours in the rest. Dials never change a background unless you put that action on one. Any web page or Shadertoy-style shader can be a background too.
- **Built-in MagTran M3 support.** The device plugin for the VSDinside MagTran M3 ships with Ectodeck. See [its README](plugins/com.grantgarrison.opendeck-magtran-m3.sdPlugin/README.md).

A deck that declares none of these features is drawn exactly as OpenDeck draws it.

## Running beside OpenDeck

Ectodeck keeps its own configuration, so both can be installed at once. The first time Ectodeck starts, it copies your OpenDeck configuration, so your profiles, settings and plugins carry over. OpenDeck's own configuration is left untouched.

## Linux permissions for the MagTran M3

Install the udev rule so the deck can be used without root, then replug it:

```sh
sudo cp plugins/com.grantgarrison.opendeck-magtran-m3.sdPlugin/40-opendeck-magtran-m3.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules
```

Elgato decks need OpenDeck's udev rules, as described in [OpenDeck's README](https://github.com/nekename/OpenDeck#linux).

## Building from source

Ectodeck builds the same way OpenDeck does. You need the [prerequisites for building a Tauri application](https://tauri.app/start/prerequisites) and [Deno](https://deno.com/). On Linux you also need `libudev` and `libdbus`. Then:

```sh
deno install
deno task tauri build --no-bundle
```

The app is built at `src-tauri/target/release/ectodeck`, with its built-in plugins beside it.

## Using Ectodeck

Everything about using Ectodeck day to day, from actions and profiles to plugins and troubleshooting, works as it does in OpenDeck. [OpenDeck's README](https://github.com/nekename/OpenDeck#readme) covers it.

## Credit

Ectodeck exists because of [OpenDeck](https://github.com/nekename/OpenDeck) by [nekename](https://github.com/nekename), who built everything Ectodeck builds on. If Ectodeck is useful to you, consider supporting OpenDeck's development on [GitHub Sponsors](https://github.com/sponsors/nekename), [Ko-fi](https://ko-fi.com/nekename) or [Liberapay](https://liberapay.com/nekename).

Please report problems with Ectodeck's additions here, not to OpenDeck.

Some built-in backgrounds are made from open-source work, each under the MIT License, with its licence kept beside it in [third_party](third_party):

- **Milkdrop** runs [Butterchurn](https://github.com/jberg/butterchurn) and its [preset pack](https://github.com/jberg/butterchurn-presets) by Jordan Berg, a web port of Ryan Geiss's Milkdrop, with presets by the Milkdrop community.
- **Ink** is [WebGL Fluid Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation) by Pavel Dobryakov.
- **Birds** and **Sky** are [Vanta](https://github.com/tengbao/vanta) effects by Teng Bao, on [three.js](https://github.com/mrdoob/three.js).

## License

Ectodeck, like OpenDeck, is licensed under the GNU General Public License v3.0. See [LICENSE.md](LICENSE.md).
