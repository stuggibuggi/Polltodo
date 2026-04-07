import type { CSSProperties } from 'react'

type WordWaveProps = {
  text?: string
  className?: string
  style?: CSSProperties
}

export function WordWave({ text = 'ICTOMAT', className = '', style }: WordWaveProps) {
  const letters = text.split('')
  return (
    <div className={`ictowave ${className}`.trim()} aria-hidden="true" style={style}>
      <div className="ictowave-coast">
        <div className="ictowave-wave-rel-wrap">
          <div className="ictowave-wave" />
        </div>
      </div>
      <div className="ictowave-coast ictowave-delay">
        <div className="ictowave-wave-rel-wrap">
          <div className="ictowave-wave ictowave-delay" />
        </div>
      </div>
      {letters.map((letter, idx) => (
        <span
          key={`${letter}-${idx}`}
          className="ictowave-text"
          style={{ ['--i' as string]: idx } as CSSProperties}
        >
          {letter}
        </span>
      ))}
    </div>
  )
}
