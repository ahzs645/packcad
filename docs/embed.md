# Embedding the PackCAD viewer

`viewer.html` is PackCAD without the editor: one project, folded in the same viewport, with a
play / stage transport. It is meant to be put in an `<iframe>` by another site, which keeps
PackCAD's React 19, three.js and Atelier out of the host's own bundle.

## Building it

```sh
pnpm build:viewer                          # viewer only, into dist/
PACKCAD_ENTRY=viewer BASE_PATH=./ pnpm exec vite build --outDir ../host/public/packcad
```

`BASE_PATH=./` makes every asset URL relative, so the output works under any path. The viewer
needs the Atelier checkout next to PackCAD (`../atelier`), exactly as the editor does. A host
that vendors PackCAD as a git submodule can vendor Atelier beside it (for example
`vendor/packcad` and `vendor/atelier`), and the `link:../atelier/...` dependencies resolve
unchanged.

## The address

| Parameter    | Meaning                                                               | Default |
| ------------ | --------------------------------------------------------------------- | ------- |
| `project`    | URL of a `.packcad.json` or `.packcad.pdf`, relative to the viewer    | —       |
| `step`       | `final`, `setup`, a stage index, or a stage id                        | `final` |
| `autoplay`   | Play the folding sequence once loaded                                 | `0`     |
| `loop`       | After finishing, hold, then fold again                                | `0`     |
| `layout`     | `3d`, `2d`, `split`, `split-vertical`                                 | `3d`    |
| `controls`   | `0` hides the transport, for a host that draws its own                | `1`     |
| `background` | Viewport background as a hex colour (`f4f4f5` or `#f4f4f5`)           | theme   |
| `theme`      | `light` or `dark`: the toolbar, inset, labels and transport           | `light` |

```html
<iframe src="packcad/viewer.html?project=../models/bus.packcad.pdf&autoplay=1"></iframe>
```

## Messages

Commands are posted to the iframe's window; only messages from the parent frame are read.

```js
frame.contentWindow.postMessage({ type: 'packcad:play' }, '*')
frame.contentWindow.postMessage({ type: 'packcad:seek', step: 3 }, '*')        // index, id, 'final', 'setup'
frame.contentWindow.postMessage({ type: 'packcad:load', url: 'other.packcad.json', step: 'setup', autoplay: true }, '*')
```

Also `packcad:pause`, `packcad:fit`, `packcad:layout` (`{ layout: '2d' }`),
`packcad:background` (`{ color: '#000000' }`) and `packcad:theme` (`{ theme: 'dark' }`). A host
that follows a light/dark toggle sends `packcad:theme` and `packcad:background` together, so the
frame changes without reloading.

The viewer posts to its parent:

- `packcad:ready` — `{ name, steps: [{ id, label, angle }], panels }` once a project opens.
- `packcad:state` — `{ playing, stepId, stepIndex, progress }` on every stage or play change,
  and at most every 100 ms while playing.
- `packcad:error` — `{ message }` when a project cannot be fetched or read.

`src/viewer/embedProtocol.ts` holds these types and is the source of truth.
