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

## Linux permissions

Install the udev rule so the deck is usable without root, then replug it:

```sh
sudo cp 40-opendeck-magtran-m3.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules
```

## Building

`cargo build --release`. Inside Ectodeck the plugin is built by `build.ts`
along with the app.
