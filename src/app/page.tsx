'use client'

import React, { ErrorInfo } from 'react'

import ActiveColorPicker from '@/components/ActiveColorPicker'
import ExportButton from '@/components/ExportButton'
import ExportSemanticButton from '@/components/ExportSemanticButton'
import ThemePreview from '@/components/ThemePreview'
import ThemeControls from '@/components/ThemeControls'
import ThemeLibrary from '@/components/ThemeLibrary'
import SyntaxColorList from '@/components/SyntaxColorList'
import ColorList from '@/components/ColorList'
import AnsiColorList from '@/components/AnsiColorList'
import MobileShell from '@/components/mobile/MobileShell'
import { useIsMobile } from '@/components/mobile/useIsMobile'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { TooltipProvider } from '@/components/ui/tooltip'

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(_: Error) {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return <h1>Something went wrong.</h1>
    }

    return this.props.children
  }
}

const ThemeGenerator = () => {
  const isMobile = useIsMobile()

  // Nothing is drawn until the breakpoint resolves. The server-rendered HTML and the first client
  // render therefore agree (clean hydration), and only one layout ever mounts — the editor preview
  // inside them carries a Monaco instance that we do not want to pay for twice.
  if (isMobile === null) {
    return <div className="h-[100dvh]" style={{ background: '#0D0D0F' }} />
  }

  if (isMobile) return <MobileShell />

  return (
    <section>
      <div className="mx-auto p-4 flex flex-col gap-5">
        <div className="flex flex-wrap lg:flex-nowrap gap-8">
          <div className="flex flex-col items-center justify-between flex-shrink">
            <div className="flex flex-col items-center flex-1 gap-5">
              <ThemeLibrary />
              <ThemeControls />
              <div className="">
                <ActiveColorPicker />
              </div>
            </div>
          </div>
          <div className="flex-1">
            <ThemePreview />
          </div>
          <div className="flex flex-col gap-5">
            <ColorList title="Theme Colors" isThemeColors={true} />
            <AnsiColorList />
          </div>
        </div>
        <div className="w-full">
          <SyntaxColorList title="Syntax Colors" isThemeColors={false} />
        </div>

        <div className="flex justify-end gap-4">
          <ExportButton />
          <ExportSemanticButton />
        </div>
      </div>
    </section>
  )
}

export default function Page() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        {/* One provider for the whole tree: the link tooltips live inside the colour
            panels, which are siblings, so neither can own the provider itself. */}
        <TooltipProvider delayDuration={300}>
          <ThemeGenerator />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}
