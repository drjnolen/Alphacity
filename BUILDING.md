# Production builds

Use Node.js 22 or newer. Run `npm ci`, then `npm run build`. The full build also
installs Climb's separately locked dependencies and builds the game and wallet gate.
Run `npm test`, `npm run test:climb`, `npm audit --audit-level=high`, and
`npm --prefix climb/game audit --audit-level=high` before publishing.

## CSS tooling

The Intel, Paylink, and Launchpad stylesheets use the pinned Tailwind 4 PostCSS
compiler through `scripts/build-css.mjs`. The one-shot build avoids the Tailwind
CLI's file-watcher dependency tree. Each `tailwind.input.css` declares its own
explicit `@source` paths, including pages in subdirectories and scripts that
construct class names. Add new template/script paths there when needed. Theme
extensions still live in the corresponding `tailwind.config.cjs` files.

`shared/tailwind-compat.css` retains the site's v3 palette and utility dimensions.
`shared/tailwind-preflight.css` is the resolved v3.4.17 base stylesheet, with its
MIT license. These are static CSS, not a vendored copy of the vulnerable v3
compiler or its dependencies. The imports intentionally remain unlayered to
preserve precedence with existing page styles. Rebuild and commit the generated
`intel/tailwind.css`, `pay/tailwind.css`, and `launchpad/tailwind.css` after changes.
The compiler targets modern browsers (Safari 16.4+, Chrome 111+, Firefox 128+),
as Climb's existing Tailwind 4 build already does.

Climb uses the shadcn component CSS from
`climb/game/src/styles/shadcn.css`, copied unchanged from shadcn 4.18.0 with its
MIT license. The component-generator CLI is not needed to build or play the
game and is no longer an installed dependency. Update this stylesheet explicitly
if future generated components require newer variants; do not add the CLI as a
runtime dependency just to import CSS.

Both dependency audits remain enabled in CI and deployment. There are no advisory
ignores, forced transitive overrides, or audit-threshold exceptions.
