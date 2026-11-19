import type { Register, ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'
import { SCENE } from './scene'

// Black ground, Claude-orange contour lines. Dark only: the map is drawn on black.
const { theme, problems } = makeColors({
  label: 'Claude Topo',
  only: 'dark',
  roles: { accent: '#d97757', danger: '#e5534b', success: '#3fb68b', warning: '#d9a441', pro: '#e48c6c' },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#0a0a0b',
        'surface-1': '#121214',
        'surface-2': '#19191c',
        'surface-3': '#1f1f23',
        'text-primary': '#f2efec',
        'text-secondary': '#cbc5c0',
        'text-muted': '#a39b95',
      },
    },
  },
})

// The knob for how much the map shows through behind panels: lower opacity = more map.
const LOOK: ThemeSetArgs = {
  colors: theme,
  backdrop: { scene: 'claude-topo', glass: { blur: 4, opacity: 0.7 } },
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))

    if (unpainted !== undefined) {
      $.ui.toast(unpainted)
    }
    await $.theme.set(LOOK)

    return next(e)
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    // Only draw when the standing theme is ours: another theme mod may have set the look.
    if (e.props.plugin !== 'claude-topo' || (e.surface !== 'desktop' && e.surface !== 'mobile')) {
      return next(e)
    }
    const { Svg } = $.ui.resolve(e)

    return <Svg source={SCENE} alt="Topographic contour lines in Claude orange on black" isInteractive />
  })
}
