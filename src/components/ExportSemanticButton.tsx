import React from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { generateSemanticThemeJSON } from '@/lib/utils/export'
import { exportFileName, metadataFor } from '@/lib/themes/exporter'

import { Button } from '@/components/ui/button'

const ExportSemanticButton: React.FC = () => {
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

  const exportSemanticTheme = () => {
    // A palette-only theme exports without a metadata block, like a foreign file (fix 1).
    const { themeJSON } = generateSemanticThemeJSON(
      themeName,
      colors,
      syntaxColors,
      ansiColors,
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
    <Button className="mt-4" onClick={exportSemanticTheme}>
      Export Semantic Theme
    </Button>
  )
}

export default ExportSemanticButton
