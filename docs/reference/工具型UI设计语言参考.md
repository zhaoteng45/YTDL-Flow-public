# Tool UI Design Language Reference

> Extracted from YTDL-Flow for reuse in other task-oriented products.

## 1. Positioning

This design language is built for **task-first tools** rather than content-first products.

It fits products where users need to:

1. provide input
2. trigger work
3. observe progress
4. resolve errors
5. confirm completion

Typical fits:

- downloaders
- converters
- batch processors
- admin utilities
- desktop companions
- queue-based operator tools

It is less suitable for:

- social products
- editorial/content products
- marketing sites
- highly narrative or illustration-led experiences

## 2. Core Philosophy

The stable core of this language is not a theme. It is a **workflow-oriented UI system** with three priorities:

1. **Primary task clarity**
   The first action must be obvious on first view.

2. **Secondary context demotion**
   Configuration and environment controls remain visible, but never compete with the main task.

3. **Independent feedback surfaces**
   Results, progress, errors, and logs must have their own visual space instead of being mixed into input and settings controls.

In short:

**Task first. Context second. Feedback always visible.**

## 3. Brand Character

The base personality can be summarized as:

- minimal
- efficient
- reliable

This is a tool language that should feel:

- direct rather than charming
- stable rather than trendy
- confident rather than soft

The default visual expression in YTDL-Flow is **Neo-Brutalism for utility software**:

- high contrast
- explicit borders
- hard shadows
- visible interaction states
- little ambiguity about what is clickable

## 4. Structural Rules

This language becomes reusable when the structure stays stable across screens.

### 4.1 Input Surfaces

Use a 3-part structure:

1. **Primary Input Block**
   The user’s main input and the single strongest CTA.

2. **Runtime Context Block**
   Supporting environment choices such as location, auth, profile, or execution mode.

3. **Feedback Block**
   Parsed results, recognized items, warnings, and removable chips.

This pattern is appropriate for any flow where input can be validated or expanded before execution.

### 4.2 Task Cards

Use a 4-part structure:

1. **Identity Region**
   What this task is.
   Example: title, source, filename, thumbnail.

2. **State Region**
   What stage it is in.
   Example: status label, progress, speed, processing indicators.

3. **Specification Region**
   What will be produced.
   Example: format, size, duration, resolution, target profile.

4. **Action Region**
   What the user can do now.
   Example: start, cancel, open folder, inspect logs.

This pattern works well for downloads, jobs, builds, exports, imports, and queue processing.

### 4.3 Settings Surfaces

Group settings by **user intent**, not backend implementation.

Recommended grouping model:

1. **Behavior**
   What the tool does by default.

2. **Access**
   Authentication, cookies, accounts, permission context.

3. **System Health**
   Dependencies, environment, diagnostics, maintenance.

4. **Advanced**
   Rare, risky, or expert-facing controls.

Each settings group should start with one short sentence answering:

**Why would a normal user care about this section?**

## 5. State Language

One of the strongest reusable patterns in this project is the state contract.

Do not let each component invent its own state wording.

Instead, define a shared visible-state layer with:

- label
- icon
- color
- whether percent should appear
- whether busy dots should appear
- whether the state is actionable

YTDL-Flow’s visible state model is:

- `Idle`
- `Analyzing`
- `Pending`
- `Downloading`
- `Merging`
- `Completed`
- `Failed`
- `Cancelled`

Key behavior rules:

- `Downloading` may show percentage.
- `Merging` must not pretend to be percentage-based if progress is not real.
- `Failed` and `Cancelled` must be distinct.
- state meaning must not rely on color alone.

This model is portable to any queue-based workflow.

## 6. Visual Foundation

### 6.1 Tokens First

Build the system from semantic tokens rather than per-component hardcoded values.

Recommended token categories:

- background
- surface
- text
- muted text
- primary
- secondary
- accent
- border
- shadow
- success
- error
- spacing
- radius
- font body / heading / mono

### 6.2 Borders and Surfaces

The default YTDL-Flow expression uses:

- strong border visibility
- low ambiguity between background and surface
- cards that clearly separate zones

This is useful for tools because it reduces hesitation and misreads.

### 6.3 Typography

Typography is functional first:

- headings should clearly organize sections
- body text should stay readable at small utility sizes
- monospace should be reserved for logs, paths, versions, and technical output

Typography should support scanning before it supports mood.

## 7. Theme Strategy

This project’s current system shows a reusable theme principle:

**Themes may change personality, but not structure.**

Themes should be allowed to change:

- color values
- border style
- shadow quality
- radius
- fonts
- texture
- decorative atmosphere

Themes should not change:

- layout hierarchy
- slot order
- state contract
- task-card anatomy
- settings grouping logic

This leads to a durable rule:

**Theme controls mood. Component controls structure. State controls meaning.**

## 8. Layering Model

The current style system in YTDL-Flow is organized into four responsibilities:

1. **Token Layer**
   Shared semantic primitives.

2. **State Layer**
   Shared visual meaning for task states.

3. **Component Layer**
   Anatomy and layout rules for reusable UI structures.

4. **Theme Layer**
   Personality mappings and visual flavor.

This is a good reference structure for any multi-theme application.

## 9. Motion Principles

Motion in this language should reinforce state, not decorate everything.

Rules:

- use motion to clarify transitions, progress, and emphasis
- do not make motion the only indicator of state
- keep default motion short and purposeful
- support `prefers-reduced-motion`

Good uses:

- progress emphasis
- state change entrance
- slight physical press feedback

Bad uses:

- decorative floating with no meaning
- large layout shifts
- motion-heavy controls that reduce readability

## 10. Interaction Rules

### 10.1 One Dominant Action

Each surface should have one clearly dominant CTA.

Examples:

- analyze
- download
- confirm
- retry

Do not create multiple equally loud buttons unless they truly represent equivalent decisions.

### 10.2 Context Is Visible but Secondary

Directory paths, cookie files, auth sources, and environment details should remain reachable without visually overpowering the main task.

### 10.3 Errors Must Be Actionable

Error states should answer:

1. what failed
2. what kind of failure it is
3. what the user can do next

## 11. What Is Portable vs. Project-Specific

### Portable Principles

These are safe to reuse in other projects:

- task-first hierarchy
- context demotion
- independent feedback region
- 4-part task card anatomy
- grouped settings by user intent
- centralized visible-state contract
- token/state/component/theme layering
- reduced-motion support

### Project-Specific Expressions

These should be adapted, not copied blindly:

- Neo-Brutalism default styling
- Codex manuscript mood
- Paper Plane visual metaphor
- exact color values
- download-specific wording
- queue semantics tied to media workflows

## 12. Reusable Design Checklist

When applying this language to another project, confirm:

1. Is the product truly task-oriented?
2. Is the primary action obvious within 3 seconds?
3. Are setup/environment controls visually secondary?
4. Are progress and errors visually isolated from input?
5. Do all task states follow one shared contract?
6. Can themes change mood without changing structure?
7. Does reduced-motion still preserve meaning?

If the answer to several of these is no, the project is using the look but not the language.

## 13. Recommended Summary for Other Projects

Use this short description when referencing the system:

> A task-first tool UI design language built around strong workflow hierarchy, explicit state feedback, stable component anatomy, and multi-theme personality on top of a shared structural core.

An even shorter summary:

> High-clarity interface design for workflow-driven tools.

