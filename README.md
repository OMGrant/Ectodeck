# MagDeck

MagDeck is a fork of [OpenDeck](https://github.com/nekename/OpenDeck) for stream controllers that aren't shaped like an Elgato Stream Deck.

OpenDeck is built around Elgato's hardware: a grid of separate keys, with any dials along the bottom. Some decks are built differently. The VSDinside MagTran M3 has transparent keys over a single display, and its dials run down the right side. MagDeck adds what those decks need and leaves everything else as OpenDeck has it. That includes Elgato hardware, which works exactly as it does in OpenDeck, and support for plugins made for the Stream Deck SDK.

## What MagDeck adds

- **A display behind the keys.** A deck can declare that its keys sit over one display. MagDeck then draws the device view as that display, with the keys placed where they physically are, and gives you a background picker for the whole display.
- **Key backgrounds on or off.** On those decks, each key can sit on its own black square or float straight on the background. With the background off, a flat square painted into an icon is removed too.
- **Rounded keys** on those decks, on the hardware and in the device view.
- **Dials on the side.** A deck can declare that its dials run down the right. MagDeck draws them there, lined up with the key grid.
- **Vector icons.** OpenDeck's own icons (Multi Action, Toggle Action and the status overlays) are redrawn as SVG, so they stay sharp at any size and have no background of their own.
- **Built-in MagTran M3 support.** The device plugin for the VSDinside MagTran M3 ships with MagDeck. See [its README](plugins/com.grantgarrison.opendeck-magtran-m3.sdPlugin/README.md).

A deck that declares none of these features is drawn exactly as OpenDeck draws it.

## Running beside OpenDeck

MagDeck keeps its own configuration, so both can be installed at once. The first time MagDeck starts, it copies your OpenDeck configuration, so your profiles, settings and plugins carry over. OpenDeck's own configuration is left untouched.

## Linux permissions for the MagTran M3

Install the udev rule so the deck can be used without root, then replug it:

```sh
sudo cp plugins/com.grantgarrison.opendeck-magtran-m3.sdPlugin/40-opendeck-magtran-m3.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules
```

Elgato decks need OpenDeck's udev rules, as described in [OpenDeck's README](https://github.com/nekename/OpenDeck#linux).

## Building from source

MagDeck builds the same way OpenDeck does. You need the [prerequisites for building a Tauri application](https://tauri.app/start/prerequisites) and [Deno](https://deno.com/). On Linux you also need `libudev` and `libdbus`. Then:

```sh
deno install
deno task tauri build --no-bundle
```

The app is built at `src-tauri/target/release/magdeck`, with its built-in plugins beside it.

## Using MagDeck

Everything about using MagDeck day to day, from actions and profiles to plugins and troubleshooting, works as it does in OpenDeck. [OpenDeck's README](https://github.com/nekename/OpenDeck#readme) covers it.

## Credit

MagDeck exists because of [OpenDeck](https://github.com/nekename/OpenDeck) by [nekename](https://github.com/nekename), who built everything MagDeck builds on. If MagDeck is useful to you, consider supporting OpenDeck's development on [GitHub Sponsors](https://github.com/sponsors/nekename), [Ko-fi](https://ko-fi.com/nekename) or [Liberapay](https://liberapay.com/nekename).

Please report problems with MagDeck's additions here, not to OpenDeck.

## License

MagDeck, like OpenDeck, is licensed under the GNU General Public License v3.0. See [LICENSE.md](LICENSE.md).
