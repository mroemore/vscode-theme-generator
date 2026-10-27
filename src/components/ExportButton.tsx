import React from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { generateThemeJSON } from '@/lib/utils/exportTheme'
import { exportFileName, metadataFor } from '@/lib/themes/exporter'

import { Button } from '@/components/ui/button'

const ExportButton: React.FC = () => {
  const {
    colors,
    syntaxColors,
    ansiColors,
    themeName,
    inputs,
    paletteOnly,
    lockedColors,
    links,
  } = useTheme()

  const exportTheme = () => {
    // A palette-only theme carries colours, not generator settings: it exports as a
    // plain VS Code theme — exactly like a foreign file — so re-importing the file
    // yields a palette-only record and the round trip holds (fix 1).
    const themeJSON = generateThemeJSON(
      colors,
      syntaxColors,
      ansiColors,
      themeName,
      paletteOnly ? undefined : metadataFor(inputs, lockedColors, links)
    )
    const blob = new Blob([themeJSON], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = exportFileName(themeName)
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Button className="mt-4" onClick={exportTheme}>
      Export Theme
    </Button>
  )
}

export default ExportButton
