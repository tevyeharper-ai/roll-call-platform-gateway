# Dream Kinetic: Forge — Design Dossier F0.4.0

## Product position

Forge is Dream Kinetic's agency-grade conversational, visual and code-capable application development platform. Roll Call is a client of Forge.

## Shell

Desktop-first premium application shell:
- Dream Kinetic / FORGE brand lockup;
- agency/project context in top navigation;
- Builder / Developer mode switch;
- left navigation grouped by Agency, Build, and Engineer;
- light neutral surfaces, restrained blue selection states, readable typography;
- avoid nested page scroll regions except intentional Studio panels.

## Forge Studio

Studio uses a three-column model on large screens:
1. conversation / AI collaboration;
2. real live preview or developer workspace;
3. context-sensitive inspector.

The conversation is not a decorative copilot. It is a first-class work surface.

### Lifecycle

`Explore → Research → Design → Build → Preview → Validate → Candidate → Certified → Release`

F0.4 exposes the first four interaction stages. Explore, Research, and Design must clearly state that they do not mutate source. Build is allowed only against development/preview state.

## Builder Mode

Designer-friendly language. Emphasize application, data, screens, workflows, permissions, Avery, preview, and release—not framework internals.

## Developer Mode

Expose code/contracts/tests/logs/runtime context while retaining the exact same underlying application as Builder Mode.

## Status communication

Forge must distinguish:
- Ready / certified;
- Pending configuration;
- Development-only adapter;
- Failed verification.

Never make a configured-but-unverified integration look healthy.

## F1.0 continuity

The F1.0 Data Builder must inherit this shell and introduce the first real visual object editor with generated schema/API/policy/test artifacts displayed in both Builder and Developer views.
