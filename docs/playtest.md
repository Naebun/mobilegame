# Playtest guide: level 2 on a real phone

Nobody has played this on a phone yet. Frame rate, the dark, touch reach and the thumb numbers are all unverified. This
guide gets the game onto a phone, says where to look, and says what to send back. About 30 minutes is enough.

## Getting it onto the phone

**Option 1: the LAN server (best for repeat testing).** On the computer, in the repo:

```
npm start
```

It prints `http://localhost:8080` and a `LAN:` address. Put the phone on the same Wi-Fi and open the LAN address in
Safari (iPhone) or Chrome (Android). If it will not load, the computer's firewall is the usual cause. The server sends
`no-store`, so a reload always picks up the latest code.

Things that differ on a plain `http://` LAN address, because the page is not a secure context:

- the service worker does not register, so there is no offline copy (not needed here);
- the copy button on the performance readout cannot use the clipboard API. It falls back to an older copy route, and if
  that is blocked as well it shows the summary in a box to press and hold. Both are untested on a phone.

**Option 2: the single file.** `npm run build:artifact` writes `dist/artifact.html`, one self-contained file with
three.js inside. Publish it as a Claude Artifact (or open it from any static host) when the phone cannot reach the
computer. It is the same code, minified. The artifact page runs inside a frame, so the clipboard is likelier to be
refused and the viewport may not be the full screen. Prefer option 1 for timing numbers.

**Add to Home Screen** (Share, then Add to Home Screen on iPhone) gives a full-screen launch with no browser bars.
Test both ways if you can: the Safari tab has a smaller, changing viewport, and the home-screen launch is how the game
is meant to be played. The manifest's start address is the site root, so an installed copy may drop `?perf` from the
address on Android. If it does, take the timing numbers from a browser tab.

## The performance readout

Add `?perf` to the address: `http://<address>:8080/?perf`. A small green panel appears at the top left, under the health
bar. On a computer the P key switches it on and off. Tap the panel to copy a one-line summary, then paste it into a
message. If the copy fails, the panel shows the line in a box: press and hold it, select all, copy. The panel takes the
touch, so a drag that starts on it does not aim. Start aiming drags anywhere else.

| Line | Meaning |
| --- | --- |
| fps, ms, js | Average over the last four seconds. `js` is how long the game's own render call took. If ms is far above js, the GPU is the limit. If they are close, the CPU is |
| 1% low | The frame time that 99 percent of frames beat, and the rate it equals. This is the number that shows stutter. max is the single worst frame |
| tier, ratio, buf | Quality tier, pixel ratio and the real drawing size in pixels. `(fixed)` means `?q=` pinned the tier. `(auto, was high)` means the game dropped quality by itself |
| tris, calls, lights | From the renderer, for the whole frame including the weapon and the bloom passes. Lights counts every visible light, with point and spot lights in brackets |
| size, L, area | Viewport, orientation, level and the area Naebun is standing in |

Pin the tier for measuring: `?perf&q=high`, then `?perf&q=medium`, then `?perf&q=low`. Without `?q` the game picks high
and steps down on its own if frames stay under about 25 fps, and it remembers that choice in the browser for next time.
If a phone looks like it is stuck on a low tier, that is why. Open it once with `?q=high` to see the real figure.

Our working targets are guesses, not requirements: 30 fps average or better, 1% low of 20 fps or better, on an
iPhone 14 class device. Write down what you see even if it is better or worse.

## What to do

1. Open the game with `?perf&q=high`, portrait. Start a new game and play level 1 through the dance floor (area 3).
   Stand in the middle of it for ten seconds with robots awake, then fight. Send the readout from both moments.
2. Start level 2 (`?level=2` starts a new game there). Fit the torch when asked. Walk the Long Vault, the Cask Cellar and
   the Close, then spend a minute in the Plague Cellar (area 5): the biggest room, a grid of columns, braziers. Send the
   readout while standing still and while fighting there.
3. Repeat the level 2 route in landscape. Landscape sees more of the room at once, so its triangle count is higher.
4. Run the Plague Cellar once at `?perf&q=medium` and once at `?perf&q=low`. We want to know where the line is.
5. If you want to reach the heavy rooms faster, switch on DEBUG MODE on the title screen for the walk. It changes
   health and damage, not the frame rate. Say that you did, and do not judge difficulty from that run.
6. Play at least one level 2 area in normal mode with the weapons you find, for the thumb and difficulty questions.

## Checklist

Answer each in a line. Say which orientation and tier, and which area.

**Frame rate**
- Average and 1% low in the dance floor and the Plague Cellar, per tier. Any visible stutter, and when?
- Did the game drop its own tier? When (which area, what was happening)?
- Does the phone get warm within ten minutes? Does the frame rate fall as it warms?
- Is Low Power Mode on? It caps iPhones at 30 fps.

**The dark**
- Can you see where to go in the Long Vault and the Close with the torch on? Is anything too dark to read, or too bright?
- Turn the phone brightness to normal indoor level and try again. Dark scenes look different on a phone panel.
- Does the torch beam read as light in the air, or as a flat shape?
- Can you tell a robot from the background before it moves?

**The torch fitting**
- The fitting animation at the start of level 2: does it make sense, and does the module click onto the pistol?
- Once fitted, can you see the torch on the pistol in portrait and in landscape? (The previous version was mostly hidden.)
- The shotgun and the Reverb Launcher come with torches already. Does the beam start at the lamp, or does it look as if
  it comes from inside the horn?
- The Vinyl Disc's lamp stands on a neck above the deck. Does it get in the way of the top of the screen in portrait?

**Touch**
- Portrait: can the left thumb reach the move box and SWAP, and the right thumb the aim box and RELOAD, without moving
  the hands? Do the buttons feel too close to the screen edge or the home bar?
- Landscape: the same, with the boxes in the lower corners. Does the notch or the rounded corners get in the way?
- Do you ever press SWAP or RELOAD when you meant to aim?
- Rotate the phone during play. Does the layout settle, and does it ever show the old size?

**Thumb aiming against the numbers**
- Aim speed is `lookX` 0.009 and `lookY` 0.0075 radians per pixel in `src/data.js` (about 0.5 degrees per pixel across, 0.4
  up and down), and `edgeTurn` 2.4 radians per second at the rim of the aim box. A 100 pixel drag turns about 50 degrees.
- Too fast, too slow, or fine? Is up and down different from sideways? Can you hold a shot on a robot's head?
- Does a drag outside the boxes (aim only, no fire) get used, or forgotten?
- With no aim assist, which fights feel unfair? Name the enemy and the area.

**Sound**
- Is the music loop there? Is it too loud against the effects? Any crackle or dropout?
- Does sound start after the first tap, and survive a pause and resume (switching apps and back)?
- Do the weapon sounds tell the guns apart? Is the Tour Guide's voice line readable?

**Anything that looks wrong**
- Flicker, shimmer on the stone, bloom that washes out the screen, text cut off by the notch, a weapon clipping the
  camera, a robot standing in a wall. A screenshot helps, with the readout visible if you can.

## What to send back

1. The device (model, iOS or Android version), browser, and whether it was a tab or an installed home-screen copy.
2. One pasted readout line for each of: dance floor, Plague Cellar portrait, Plague Cellar landscape, each at
   whichever tiers you tried.
3. Your answers to the checklist, a line each. Say "did not test" where you did not.
4. Screenshots of anything wrong. On iPhone, press the side button and volume up together.
5. Whether DEBUG MODE was on at any point.

## What this cannot tell us

The readout shows frame cadence, not GPU time: browsers on phones do not expose a reliable GPU timer, so "GPU limited" is
an inference from `ms` against `js`. The triangle count is whatever the renderer drew, and it moves with the view because
the level is merged into chunks. Everything in the checklist about feel is one person's opinion on one phone, which is
what we want at this stage, and it should not be read as settled.
