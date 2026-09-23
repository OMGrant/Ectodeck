# MagTran M3 device plugin

Device support for the VSDinside MagTran M3 (USB `5548:1020`), for
[Ectodeck](https://github.com/OMGrant/Ectodeck), which bundles it, and for
[OpenDeck](https://github.com/nekename/OpenDeck).

The M3's fifteen keys are windows onto one 854×480 display. The plugin draws
that whole display itself: the background you choose, with each key's image
composited at the position of its physical cap, and sends it to the deck as
one picture. After that, a key change repaints only that key's square.

- 15 keys and 3 dials, reported in reading order
- a full-display background, set from the device view
- key images with or without their own background, with rounded corners
- key positions tuned to the caps; override per unit in
  `~/.config/opendeck-magtran-m3/layout.json`
  (`{"left":43,"top":20,"right":43,"bottom":20,"key":110}`, watched live;
  add `"calibrate": true` to outline each key)

Ectodeck shows the dials down the right side and the background behind the
keys. Stock OpenDeck drives the keys and dials but has no background control.

## Making your own animated background

A background can be a web page or a Shadertoy-style fragment shader. Either can react to the deck.

A **shader** gets Shadertoy's usual uniforms, plus:

- `iKeyPresses[8]`: the eight most recent presses, newest first. `xy` is the key's centre in pixels from the bottom left, `z` the seconds since the press, `w` the key's number (−1 for an empty slot).
- `iAudioBands[32]` and `iAudioLevel`: what the computer is playing, from 40 Hz to 11 kHz and overall, each 0 to 1. Naming either one is what turns on listening.

A **web page** receives window events:

- `ectodeck:press` with `{ key, down, x, y }`, where `x` and `y` run from 0 to 1 from the top left. The page also gets a real click at the key.
- `ectodeck:params` with every setting, when a setting or preset changes, if the page's source mentions `ectodeck:params`. The address already holds the new settings, so a page can apply what it can in place and reload for the rest. Any other page is reloaded with the new settings in its address.
- `ectodeck:audio` with `{ bands, level, wave }` every frame, if the page's source mentions `ectodeck:audio`. `wave` holds the last 1024 samples as bytes centred on 128.

Sound is read from the default output's monitor with `parec`, only while a background that asks for it is showing. Adjustable settings are declared as ISF `INPUTS`, in a JSON comment at the top of a shader or in `<script type="application/json" id="ectodeck-inputs">` in a page. Presets are named groups of settings: list them as `PRESETS: [{ "NAME": "Ocean", "VALUES": { … } }]`, or mark one choice input with `"PRESET": true` to make its choices the presets. People pick a preset in Adjust, and the **Background preset** action, on a key or a dial, switches to the next one; the deck's dials never change a background unless someone puts that action on them. To preview a shader offline as the deck will draw it, run `cargo run --release --example render -- <shader> <out-dir> [seconds] [key@seconds,…] [settings-json] [music]`.

## Linux permissions

Install the udev rule so the deck is usable without root, then replug it:

```sh
sudo cp 40-opendeck-magtran-m3.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules
```

## Building

`cargo build --release`. Inside Ectodeck the plugin is built by `build.ts`
along with the app.
