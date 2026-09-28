# APP STYLE GUIDE

> Version 0.1.1 · 2026-09-09
> This document is the source of truth for the project's visual design, interaction, content, and audience.

## 1. Product Direction

This personal application presents, tests, and documents game-development work. It serves as both a portfolio and a creative tool that grows with each project.

Product keywords: TECHNICAL · MODULAR · PRECISE · DARK · EXPERIMENTAL · PLAYABLE

Design references:

- TouchDesigner: real-time data, node systems, parameter panels, and performance feedback
- Max/MSP: modular structure, patch cables, and clear inputs and outputs
- 3D editors: spatial grids, coordinates, viewports, hierarchy, and inspectors
- Development tools: dense but readable information, visible state, and traceable changes

Use the systems thinking found in these tools without copying trademarks, icons, or interface layouts.

## 2. Visual System

### Color Tokens

The interface uses a hierarchy of black surfaces. International Klein Blue is the primary accent. Status colors appear only when needed for system feedback.

    --color-black: #000000;
    --color-bg: #050505;
    --color-surface-1: #0b0b0d;
    --color-surface-2: #121216;
    --color-surface-3: #1a1a20;
    --color-accent: #002fa7;
    --color-accent-bright: #1748d4;
    --color-accent-soft: rgba(0, 47, 167, 0.18);
    --color-accent-line: rgba(23, 72, 212, 0.55);
    --color-text: #f2f2f4;
    --color-text-secondary: #a0a0aa;
    --color-text-disabled: #5b5b64;
    --color-line: #28282f;
    --color-grid: rgba(255, 255, 255, 0.08);
    --color-success: #3ddc97;
    --color-warning: #ffb020;
    --color-error: #ff4d5e;

Color rules:

1. Use Klein Blue for controls, current selections, key values, and focus states.
2. Keep blue below approximately 15% of a single view's area.
3. Do not use blue for ordinary body text.
4. Use success, warning, and error colors only for real status feedback.
5. Objects inside a 3D scene may use their own colors, but the application shell still follows the single-accent rule.

### Typography

- English interface, body text, parameters, and source reading: Helvetica or DengXian, with Arial as a system fallback.
- Chinese annotations: FangSong, with STFangsong as a system alternative.
- `typography.css` applies character-range-specific local fonts to every page and GUI. Source viewers also follow this typography policy.
- English is the primary website language. Chinese may be used for supplemental annotations and code comments, not primary navigation or explanatory copy.

| Token | Size | Use |
| --- | ---: | --- |
| display | 48–72 px | Primary page title; use sparingly |
| heading-1 | 32 px | Page title |
| heading-2 | 22 px | Panel or feature title |
| body | 14–16 px | Body copy and explanations |
| ui | 12–13 px | Buttons, labels, and tables |
| micro | 10–11 px | Time, status, and technical metadata |

Use uppercase English with moderate letter spacing for technical labels, such as SCENE / OBJECT_01 / ACTIVE. Use plain English sentences for explanations.

### Grid, Spacing, and Surfaces

The base spacing unit is 4 px. Preferred values are 4, 8, 12, 16, 24, 32, 48, and 64 px.

- Use a 12-column desktop grid.
- Prefer a width of 280–360 px for tool panels.
- Limit the content area to 1440 px.
- Keep spacing between panels compact and spacing between sections generous.
- Use a 2 px default radius and a maximum 4 px radius for floating panels.
- Use a 1 px solid #28282f border.
- Avoid large pill-shaped buttons and decorative shadows.

## 3. Interface Language

Recommended application shell:

    APP / PROJECT    STATUS           FPS / SAVE / MENU
    PROJECT / SCENE          VIEWPORT          INSPECTOR / PARAMS
    TIMELINE / CONSOLE / DEVELOPMENT NOTES

For small screens:

1. Keep the main viewport.
2. Convert project navigation into a drawer.
3. Move the inspector into a bottom panel.
4. Collapse the console by default.

### Component Rules

Buttons:

- Primary: Klein Blue background with white text
- Secondary: transparent background with a gray border
- Danger: red only for destructive operations
- Hover: increase brightness without large movement
- Focus: show a visible 2 px blue outline

Panels:

- Use a 32 px title bar.
- Use micro-sized uppercase technical labels.
- Show whether collapsible panels are expanded.
- Align parameter names left and values right.

Nodes:

- Place input ports on the left and output ports on the right.
- Give selected nodes a blue border without recoloring the full node.
- Use gray connections by default and blue for active data flow.
- Give every port a text label or accessible name.

Standard status terms:

- DRAFT: concept only
- PROTOTYPE: core behavior can be tested
- TESTING: feedback is being collected
- OPTIMIZING: performance or experience is being improved
- RELEASED: available publicly
- ARCHIVED: preserved but no longer in active development

## 4. Interaction

1. Every action must produce immediate visible feedback.
2. Parameter changes should update the viewport in real time when practical.
3. Deletion, replacement, and reset operations must support undo or confirmation.
4. Show technical state explicitly.
5. Reveal advanced parameters progressively.

Motion timings:

- Micro-interaction: 120–180 ms
- Panel expansion: 180–240 ms
- Page transition: 240–320 ms
- Easing: cubic-bezier(0.2, 0.8, 0.2, 1)
- Avoid meaningless looping animation.
- Support prefers-reduced-motion.

3D viewport controls:

- Left-drag: rotate
- Mouse wheel: zoom
- Right-drag: pan
- Click an object: select
- F: focus selection (future feature)
- Esc: clear selection (future feature)

Place the grid on the XZ plane. Major axes should appear brighter than secondary lines and fade with distance.

## 5. Content System

Content hierarchy:

    App
    ├── Profile: creator identity and direction
    ├── Projects: games and interactive work
    │   ├── Overview: concept, status, and technology
    │   ├── Builds: previewable versions
    │   ├── Devlog: chronological development record
    │   ├── Decisions: design and technical choices
    │   └── Metrics: performance and playtest results
    ├── Experiments: small visual or code studies
    ├── Learning: courses, notes, and reflections
    └── Roadmap: planned work

Writing rules:

- Be concise, accurate, and verifiable.
- State the result before the implementation process.
- Distinguish facts, observations, and hypotheses.
- Record failures and tradeoffs as well as successes.
- Describe each optimization through its problem, change, and verified result.
- Write all Obsidian project records in clear English so classmates and instructors can read them without translation.
- Chinese or mixed Chinese-English conversation may still be used outside the notes.

### Development Log Template

    ## YYYY-MM-DD / BUILD 000

    **Status:** DRAFT | PROTOTYPE | TESTING | OPTIMIZING | RELEASED

    ### Goal
    What single problem does this build address?

    ### Changes
    - What changed:
    - What remained unchanged:

    ### Test
    - Preview URL:
    - Test device:
    - Steps:
    - Result:

    ### Decision
    Why was this approach selected? Which alternative was rejected?

    ### Next
    What single concept is planned for the next level?

### Game Optimization Template

    ## OPT / 000 — Optimization Name

    - Problem:
    - Hypothesis:
    - Baseline:
    - Variable changed:
    - Result after change:
    - Player feedback:
    - Decision: keep / adjust / revert

## 6. Audience

Primary user — Creator:

- Goal: quickly build, preview, and document game experiments
- Needs: clear project state, parameters, versions, and next steps
- Common path: open project → run preview → edit → test → write log
- Success criterion: explain each change and restore or compare versions

Secondary user — Classmate or Instructor:

- Goal: quickly understand what the assignment accomplishes and how to use it
- Needs: concise instructions, clear controls, and a stable preview link
- Common path: open shared link → interact with scene → read development notes
- Success criterion: complete the basic interaction without verbal guidance

Future user — Player or Visitor:

- Goal: play the game and understand its development
- Needs: fast entry, clear feedback, and a short development story
- Common path: discover project → play → review updates
- Success criterion: understand the core mechanic and return for a future version

## 7. Future Content Backlog

| ID | Content / Feature | User | Value | Priority | Status |
| --- | --- | --- | --- | --- | --- |
| C-001 | React Three Fiber basic scene | Classmate | Demonstrate basic 3D concepts | P0 | RELEASED |
| C-002 | Coordinates and transforms learning page | Creator | Understand position, rotation, and scale | P0 | NEXT |
| C-003 | Selectable 3D objects | Creator | Learn events and React state | P1 | DRAFT |
| C-004 | Starlight Collection playtest page | Player | Experience the first complete game | P1 | PROTOTYPE |
| C-005 | Game optimization comparison | Visitor | See the effect of iteration | P1 | DRAFT |
| C-006 | Node-based experiment navigation | Creator | Connect projects, logs, and experiments | P2 | IDEA |

Priority definitions:

- P0: required for the current learning or release milestone
- P1: immediately valuable after the current milestone
- P2: useful but not required for the core experience
- P3: saved as an idea with no current development commitment

## 8. Accessibility and Quality

- Body text and backgrounds must meet at least WCAG AA contrast.
- Every interactive element must support keyboard focus.
- Do not use color as the only status indicator.
- Canvas content must provide a text explanation or accessible alternative.
- Touch targets must be at least 44 × 44 px.
- Test desktop, tablet, and phone layouts.
- Public builds must not expose local absolute paths or private information.
- Keep animation stable with a target of 60 FPS.
- Run npm run build and inspect the browser console before release.

## 9. Definition of Done

- [ ] Follows the black and Klein Blue visual system
- [ ] Uses the established spacing and type hierarchy
- [ ] Works on desktop and mobile
- [ ] Shows clear keyboard focus and status feedback
- [ ] Contains no unrelated UI, animation, or dependency
- [ ] Passes local preview testing
- [ ] Passes the production build
- [ ] Updates the Obsidian development log in English
- [ ] Defines the next step

## 10. Change Log

### 0.1.0 / 2026-09-02

- Established the black and Klein Blue visual foundation
- Defined a technical and modular interface language
- Created the content architecture and development-log templates
- Defined three core audience groups
- Created the future-content backlog and completion criteria

### 0.1.1 / 2026-09-09

- Established English as the default language for all Obsidian project records
- Kept conversational collaboration available in Chinese and English
