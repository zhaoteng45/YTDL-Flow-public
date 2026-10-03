# Three-Theme Experience Reconstruction

Date: 2026-09-30
Scope: Petrol Sage, Microsoft Fluent, Google Material 3
Product mode: Operate (desktop utility)
Native authority: Tauri/WebView2; browser matrices are deterministic QA only.

## Goal

Rebuild the supported three-theme experience as three coherent interface systems rather than palette swaps. Business semantics, task lifecycle, command availability, credentials, and download/runtime contracts remain shared. Layout, surface hierarchy, settings information architecture, log presentation, micro-interactions, and motion may differ by theme.

## Shared product rules

- Media/task state outranks decorative chrome.
- One dominant surface per local region; nested controls become progressively lighter.
- Primary path stays paste/analyze -> choose format -> download -> inspect result.
- Logs are directly reachable but visually tertiary until expanded.
- Settings use progressive disclosure; expert controls stay available without dominating the default scan path.
- No system emoji in operational chrome.
- Minimum interactive target 44x44px where practical.
- No new animation dependency. Motion uses CSS transform/opacity/color/border/background only.
- No `transition: all`.
- Continuous animation is reserved for real active state (progress/spinner/QR scan) and disabled by `prefers-reduced-motion`.
- Large-area `backdrop-filter` is avoided; blur may be used on small transient/header surfaces only.
- Native Human Gate remains mandatory after material visual changes.

## Theme A — Petrol Sage

Thesis: calm tactile workbench.

- Default theme and brand authority.
- Mist-neutral canvas, deep ink structure, petrol action color, gray-green offset depth.
- Strong geometry is reserved for the outer operation panel, primary CTA, focused/active task, and modal.
- Queue cards use restrained 1px structure and subtle elevation; semantic status is local, not a full-card repaint.
- Desktop shell: compact top bar + 380-400px operation rail + flexible task workspace.
- Settings: left navigation rail + calm card groups, not a horizontal tab strip.
- Logs: dark petrol terminal surface with high-contrast mono text and restrained semantic accents.
- Motion: short 120-180ms tactile press/expand feedback, no bouncy decorative motion.

## Theme B — Microsoft Fluent

Thesis: Windows operations console.

- Segoe UI Variable/system typography.
- Neutral layered surfaces, 1px structure, small 4-8px radii, restrained elevation.
- Avoid mimicking Fluent with heavy acrylic everywhere; large panes remain opaque for performance.
- Desktop shell: integrated left operation pane + content workspace.
- Settings: Windows-like left NavigationView rail and content cards.
- Logs: Windows Terminal-like dark console nested inside a light Fluent card.
- Motion: quick 100-167ms state transitions; larger transient surfaces <=220ms. No transform movement on high-frequency toolbar hover.
- Adaptive behavior follows desktop-window pressure rather than mobile metaphors.

## Theme C — Google Material 3

Thesis: adaptive task studio.

- Material 3 semantic roles: primary/container/surface-container/outline.
- Large rounded containers and tonal hierarchy instead of hard outlines.
- Desktop shell: task-first main pane + right supporting operation pane on wide windows; support pane stacks above content when narrow.
- Settings: vertical destination rail + rounded surface-container groups.
- Logs: dark high-contrast terminal container with Material shape/elevation and tonal header.
- Motion: Material emphasized-decelerate feel using `cubic-bezier(0.2, 0, 0, 1)`, mostly 160-220ms, transform/opacity only for spatial changes.

## Home-shell audit findings

1. The former header dedication badge competes with operational controls and uses system emoji. Remove it from the operational header.
2. The header should carry only brand/version + theme/settings.
3. Petrol still inherits too much legacy Neo card weight; reduce nested hard shadows.
4. Fluent uses large-pane backdrop filters that are expensive and unnecessary; keep blur only on the sticky header/transient overlays.
5. Material's main/support split is directionally correct and should be reinforced with clearer container roles.

## Settings audit findings

1. Petrol uses horizontal tabs while the two system themes use vertical navigation; with only four top-level categories, all three themes benefit from a desktop left rail at wide widths.
2. Setting groups currently read as long document sections separated by dashed rules. Recompose them visually as grouped settings cards while preserving existing DOM and behavior.
3. Expert disclosure remains appropriate, but summary rows need theme-native hover/focus and clearer nested hierarchy.
4. Tool health/update rows should read as status cards rather than generic form blocks.
5. Nested auth/QR dialogs need theme-specific shapes without inheriting the settings-frame geometry.

## Log audit findings

1. Logs already have a dedicated region and safe redaction boundary; preserve semantics.
2. Log chrome is visually close to ordinary app surfaces. Make it a distinct console information mode.
3. Expand/collapse motion should use short interruptible transform/opacity transitions; keyboard-triggered actions should not delay content availability.
4. Keep copy/show-command controls visible but subordinate.
5. Use CSS containment on the console region to bound paint.

## Motion system

Shared tokens:
- fast: 110ms
- standard: 160ms
- spatial: 220ms
- tactile ease-out: cubic-bezier(0.23, 1, 0.32, 1)
- standard emphasized: cubic-bezier(0.2, 0, 0, 1)

Allowed:
- button press scale/translate <= 1-2px
- popover/dropdown enter opacity + 4px translation
- logs panel opacity + 6px translation
- modal opacity + 0.98 -> 1 scale
- progress transforms

Avoid:
- layout-property animation
- blur animation on large areas
- staggered task-list entrances during normal queue operation
- repeated floating/pulsing decoration
- theme-switch full-page animation

## Performance contract

- No new JS animation library.
- Do not animate width/height/top/left/margins for routine interactions.
- Remove large-pane backdrop filters from app shells.
- Bound log paint with `contain`.
- Preserve lazy thumbnail loading.
- Build bundle size must not materially regress from the existing Vite baseline.
- Real native feel/performance is a Human Gate.

## Evidence contract

Automated:
- focused three-theme style contract
- existing semantic Vitest suite
- App Shell audit
- InputSection matrix
- DownloadList matrix
- Settings matrix
- typecheck/lint/Vite build/agent:check

Native:
- 1600 / 1280 / 900 window widths
- three themes
- empty state + active queue + expanded logs + Settings (all four destinations)
- modal/auth/QR visual inspection
- reduced-motion OS setting
- sustained active download for animation smoothness
