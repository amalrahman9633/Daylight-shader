# Daylight TODO

## Done
- [x] Vite + TypeScript scaffold (no runtime dependencies)
- [x] Milestone 1: full-screen WebGL2 canvas, #F7F5F0 background, `branch.png` soft shadow
  - Opacity 0.35, softness 0.45 (32-tap spiral blur on mipmaps)
  - Wind: CPU wind model (`src/wind.ts`) rotates the whole branch around an off-screen pivot, with occasional gusts; shader adds a small noise flutter toward the tips
  - Shadow math in linear light with a cool shadow tint; dither against banding
  - DPR capped at 2, pauses in hidden tabs, still frame for reduced motion, WebGL fallback message, fade-in on load
- [x] Renamed `public/maks` → `public/masks`
- [x] Milestone 2: sliders for all 8 controls
  - `src/state.ts`: settings in slider units + tiny subscribe store (defaults = Branch in wind)
  - `src/ui/controls.ts`: controls built from definitions, 4 collapsible groups (Light, Shadow, Motion, Surface)
  - `src/renderer.ts`: WebGL code; `toShaderValues()` is the one place slider units become shader values
  - Light angle = stretch + lean around the branch pivot (a plain offset smeared the clamped mask edge)
  - Warmth tints lit areas cool→golden (luminance-normalized); shadows go grey→blue as light warms
  - Grain: animated at 24fps, triangular noise, slightly weaker in highlights
  - Panel is a temporary floating card; proper sidebar comes in the UI step

- [x] Milestone 3: presets + crossfade + Surprise me
  - `src/presets.ts`: each preset = slider values + a scene (masks, tiling, drift, wind response, blur, levels, lean axis)
  - Shader draws two scene slots (A/B, up to 3 layers each) and blends with `uMix`; layers stack multiplicatively
  - `src/transition.ts`: sliders glide over 1.2s while the scene crossfades; grabbing a slider cancels the glide
  - Picking a preset mid-fade hurries the current fade (0.25s) then starts the next: never snaps
  - Masks load lazily (current preset first, rest in background); uploads use spare texture unit 7
  - Leaves tuned: larger tiles, less blur per layer, small layer subtle. Cloud uses levels [0.35, 0.75] for contrast
  - Surprise me: random preset + values inside per-preset safe ranges + curated light backgrounds

- [x] Milestone 4: UI + sharing
  - Desktop: canvas left in a framed viewport, **sidebar on the right** (owner's choice, CLAUDE.md updated), bottom bar with play/pause + aspect ratio
  - Frame animates between ratios via a registered `--ratio` CSS property; container query units size it
  - Mobile (≤760px): canvas full-bleed at top, bar under it, bottom sheet (presets scroller peeks; "Adjust" expands controls + share)
  - Light/dark UI: follows system, toggle saved in localStorage (`daylight-theme`)
  - Play/pause (button + Space). Reduced motion starts paused
  - `src/url.ts`: address bar stays in sync (?p=&a=&w=&s=&o=&v=&wi=&bg=&g=&r=), links restore the look; invalid values fall back safely
  - Share section: Copy link, Copy embed code (iframe to `?embed&...`, which renders the canvas only). Clipboard failure shows a selectable textarea
  - States: no-WebGL message in the frame, mask load error message, preset buttons revert if a mask fails
  - Branch crop re-anchored (align x 0.2) so tall ratios keep the leaves in view

- [x] Milestone 5: PNG export
  - `src/export.ts`: 1x = 1280px long edge, 2x, 4x (16:9 4x = 5120×2880). Filename `daylight-<preset>-<w>x<h>.png`
  - `renderer.renderStill()`: draws the current frame into an offscreen framebuffer in 512px strips, reads pixels, flips rows; live preview untouched
  - Sizes beyond the GPU's max texture/viewport size are disabled; encode failures show "try a smaller size"
  - Export section in sidebar (above Share) + "Video export: Coming soon" badge
  - Note: grain makes PNGs large (4x ≈ 22 MB with grain 15)

- [x] Milestone 6a: custom shadow uploads (scope change by owner, CLAUDE.md updated)
  - `src/custom/mask.ts`: decode + downsize (≤2048), alpha → mask for cut-outs, else brightness with border-based polarity; Otsu auto-threshold; `detectLayout` finds attached edge or full-frame pattern
  - `src/custom/custom.ts`: state store + scene builder. Defaults: pattern → Drift, attached → Sway, floating → Still
    - Sway: pivot 0.08 outside the detected edge; anchor override Auto/↑/→/↓/←
    - Drift: mirrored repeat (seamless; faint symmetry where tiles meet), scale 1.2
    - Still: sway 0, flutter only
    - Threshold updates instantly via levels uniform; Invert/motion/anchor rebuild the texture and crossfade
  - `src/custom/storage.ts`: last upload + options in IndexedDB; restored on load (not auto-selected)
  - Renderer: scenes are objects (not ids), masks can be any aspect (`uSceneAspect`, shape math in proportional units), custom textures retired after fades
  - UI: "+ Upload your own" tile (becomes "Your own" with thumbnail), "Your shadow" panel, drag-and-drop anywhere with drop overlay, friendly errors
  - Removed: Copy link, address-bar sync, `?embed` mode (`url.ts`, `ui/share.ts` deleted)

- [x] Upload guide: "+ Upload your own" opens a `<dialog>` (`src/ui/upload-guide.ts`) with title, white-on-black guidance, the three preset masks as examples, tips, Cancel / Choose image. Drag-and-drop and Replace skip it

- [x] Uploads now match presets (tested by uploading `branch-trees.png`: pivot (0.554, 0.948) vs preset (0.56, 0.95))
  - Threshold is baked into the mask on the CPU *before* the shader blur (`bakeThreshold`), so Softness works on uploads; shader levels stay [0, 1]. Slider re-bakes once per frame via `renderer.updateCustomMask` (texSubImage2D, no crossfade)
  - `detectLayout` returns the shape's bbox + per-side info; finds edge attachment, or a stem (side band where every line has shape but < 8% filled), e.g. tree trunks or a hanging stalk
  - Custom Sway/Still scenes crop to the shape (+4% margin), stem side trimmed 3% so it runs off-frame; pivot 0.08 beyond the stem, centered on it
  - Forced Sway on a floating shape uses the thinnest side, never "hang from above"

## Next
- [ ] Owner to try a snippet on a real site (Webflow/Framer/WordPress embed blocks, plain HTML). Builders that insert HTML via innerHTML won't run scripts
- [ ] Possible: strip GLSL comments from the player bundle (~5 KB smaller)
- [x] Milestone 6b: "Copy code" (sidebar section "Use on your website")
  - `src/player.ts` = embeddable player (same renderer, no UI). Built by `vite.player.config.ts` into `src/generated/player.js` (≈20 KB, git-ignored) via `predev`/`prebuild`
  - `src/snippet.ts`: `<div>` (ratio, bg) + `<script>` with player + JSON config + masks as data URLs (≤1024px, PNG or JPEG whichever is smaller). Custom uploads include their scene
  - Player: canvas behind div content (z-index -1, isolation), pauses offscreen (IntersectionObserver) + hidden tab, reduced motion = still, no WebGL = plain bg color
  - Sizes: branch ≈195 KB, blinds ≈208 KB, leaves ≈146 KB, cloud ≈183 KB, custom ≈90 KB
  - Clipboard blocked → downloads `daylight-snippet.html`
  - Renderer option `preload: false` so the player doesn't fetch other presets
- [x] Dappled leaves now uses the owner's maple image (`public/masks/leaves-maple.png`, 1536×1024 grayscale, converted from their WebP). One layer, mirrored wrap, sways/flutters instead of drifting (image isn't tileable)
- [x] Owner confirmed they own the maple and blinds images
- [x] Window blinds now uses the owner's `blinds-window.png` (1254² band with window-frame break). Extend wrap, `bob` = slow sun-creep (≈40s cycle at speed 8), leanAmount 0.3 (image is already slanted), align y 0.6
- [x] Branch in wind now uses the owner's `branch-trees.png`. Pivot (0.56, 0.95) below the trunks; new scene `crop` [0, 0.15, 1, 0.84] (framing area) keeps trunks running off the bottom at every ratio
- [x] Fixed: canvas flashed black while resizing (e.g. ratio animation). Resize observer now redraws synchronously
- [x] Deleted unused originals (`branch.png`, `blinds.png`, `leaves-large/medium/small.png`) at the owner's request
- [x] README.md (features, upload tips, Copy code, run locally, how it works, structure) + MIT LICENSE + docs/screenshot.jpg
- Landing page: dropped by the owner (2026-10-23), don't build

## Notes
- `public/masks/make_masks*.py` will be copied into the build output because they live in `public/`. Consider moving them to a `tools/` folder.
