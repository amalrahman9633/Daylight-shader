# Daylight

A free, open-source web tool that generates animated light-and-shadow backgrounds (branch shadows in wind, window blinds, dappled leaves, soft cloud shadows). The owner is a product designer, so visual craft and interaction feel matter as much as the code. It is a portfolio piece and should feel like a polished, shareable product, not a tech demo.

## How we work

- Work in small steps. After each step, run the dev server and tell me what to look at.
- Before writing a big chunk of code, state the plan in a few lines.
- After each working step, suggest a git commit message.
- Explain new shader or WebGL concepts briefly when you introduce them. I am a designer learning the code side.
- Never add features that are not in the v1 scope below without asking.
- Keep dependencies minimal. Ask before adding a library.
- When I describe a visual problem ("the edge feels harsh", "the wind looks like a wobble"), treat it as a design requirement and tune the shader values, not just the code.

## v1 scope

Included:
- Live full-screen preview canvas (WebGL fragment shader), with play/pause
- 4 presets: Branch in wind, Window blinds, Dappled leaves, Soft cloud
- "Surprise me" button that randomizes within safe ranges
- Controls (about 8, in collapsible groups): light angle, warmth, shadow softness, shadow opacity, motion speed, wind strength, background color, grain
- Aspect ratio switcher: 16:9, 4:3, 1:1, 9:16
- Export: PNG still at 1x, 2x, 4x (captures the current frame)
- Custom shadow uploads: the user's image is converted to a mask in the browser, with three motion styles (Sway, Drift, Still), threshold and invert. Added by the owner on 2026-10-23.
- "Copy code": one self-contained snippet (player + mask images inline) that works on any website with no hosting, for presets and custom uploads alike
- Light/dark UI toggle
- A landing section with looping example previews, and a README

Not in v1 (do not build, even if easy):
- Video export (planned for v1.1, show as "Coming soon")
- Accounts, cloud saving, public gallery
- Shareable links / URL-stored settings (removed by the owner on 2026-10-23; "Copy code" replaces sharing)
- More than the 4 presets above

## Suggested stack

Vite + TypeScript, raw WebGL (or OGL if it saves real effort) for the shader. Plain CSS or a small utility setup for the UI. No backend. If you think another stack is clearly better, propose it in a few lines and wait for my answer.

## Assets

Shadow masks live in `public/masks/`, 2048x2048 grayscale PNGs where white is shadow and black is light:

- `branch-trees.png`: 1254×1254 two young trees, supplied by the owner (2026-10-23) and used by Branch in wind. NOT tileable; black on every edge. Sways from below the trunks; framing crop hides where the trunks end.
- `blinds-window.png`: 1254×1254 band of slat shadows with a window-frame break, supplied by the owner (2026-10-23) and used by Window blinds. NOT tileable: extend edges, slow "sun creep" bob instead of scrolling.
- `leaves-maple.png`: 1536×1024 maple leaves, supplied by the owner (2026-10-23; owner confirmed they own the rights) and used by Dappled leaves. NOT tileable: mirror wrapping, sway and flutter in place, no drift.
- `cloud.png`: tileable soft noise, never fully black or white.

All masks are either procedurally generated or owned by the owner, so they are safe to ship in an open-source project.

## Shader approach

- Sample the mask, blur by the softness value, multiply by opacity, and darken the background color with it.
- Wind: displace the mask sample coordinates with slow noise. For the branch add occasional stronger gusts rather than a constant wobble. Move the whole shadow, do not distort the shape unnaturally.
- Light angle shifts the shadow offset and skew. Warmth tints the light between cool and golden.
- Grain is subtle, felt more than seen.
- Presets crossfade smoothly when switching. Never snap.

## Starting preset values

Sliders 0 to 100. Light angle in degrees (0 is straight above). These are first guesses to tune by eye.

| Parameter | Branch in wind | Window blinds | Dappled leaves | Soft cloud |
|---|---|---|---|---|
| Light angle | 35 | 55 | 20 | 0 |
| Warmth | 40 | 65 | 55 | 20 |
| Shadow softness | 45 | 15 | 60 | 90 |
| Shadow opacity | 35 | 45 | 30 | 18 |
| Motion speed | 30 | 8 | 40 | 12 |
| Wind strength | 55 | 0 | 65 | 10 |
| Background | #F7F5F0 | #F3EEE6 | #F4F6EF | #F1F4F8 |
| Grain | 12 | 18 | 15 | 8 |

Each preset is a config object, so adding a new one later is just adding data.

## UI and design principles

- The preview is large and calm and fills most of the screen. Controls are small and quiet beside it.
- Desktop layout: right sidebar with presets then control groups (owner's choice, changed from left), large canvas on the left, thin bottom bar with play/pause and aspect ratio.
- Mobile layout: canvas full-bleed at the top, controls in a bottom sheet, presets as a horizontal scroller.
- Slider changes must feel instant, with no lag.
- Start with a gentle default animation on first load so the page feels alive immediately.
- Include considered empty, loading, and error states (for example, WebGL not supported).
- Support keyboard focus and reasonable contrast in the UI. Respect reduced-motion preferences by pausing the animation by default.

## Performance

- Target smooth 60fps on a mid-range laptop and a recent phone.
- Render at devicePixelRatio but cap it (for example at 2) in the live preview. Render PNG exports offscreen at the chosen scale.
- Pause rendering when the tab is hidden.

## Project structure (suggested)

```
daylight/
  public/masks/
  src/
    shader/        fragment and vertex shaders
    presets.ts     preset config objects
    state.ts       settings state and URL serialization
    ui/            sidebar, controls, export panel
    export.ts      PNG export
  CLAUDE.md
  TODO.md
  README.md
```

## First milestone

A full-screen canvas with an off-white background and `branch.png` as a soft shadow (opacity about 0.35, blur in the shader) with a slow wind sway. No UI yet. Run the dev server and describe what I should see. After I approve the look, we add sliders, then presets, then the UI, then export, then sharing, then the landing page and README.

Current focus (owner's decision, 2026-10-23): finish custom uploads and "Copy code" before the landing section and README.

Keep a `TODO.md` updated with what is done and what is next, so a fresh session can pick up easily.
