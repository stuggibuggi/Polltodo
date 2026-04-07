import { useTheme } from '../../lib/theme'

export function WaveBackground() {
  const { theme } = useTheme()
  const dark = theme === 'dark'
  const op1 = dark ? '0.34' : '0.18'
  const op2 = dark ? '0.58' : '0.42'
  const op3 = dark ? '0.82' : '0.56'
  const dur1 = dark ? '16s' : '24s'
  const dur2 = dark ? '12s' : '18s'
  const dur3 = dark ? '8s' : '14s'

  return (
    <div className="home-wave-layer" aria-hidden="true">
      <svg
        className="home-wave-svg"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMax slice"
      >
        <defs>
          <linearGradient id="icto-wave-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="var(--wave-stop-1)" />
            <stop offset="50%" stopColor="var(--wave-stop-2)" />
            <stop offset="100%" stopColor="var(--wave-stop-3)" />
          </linearGradient>
          <path
            id="icto-wave-path"
            fill="url(#icto-wave-gradient)"
            d="M-363.852,502.589c0,0,236.988-41.997,505.475,0s371.981,38.998,575.971,0s293.985-39.278,505.474,5.859s493.475,48.368,716.963-4.995v560.106H-363.852V502.589z"
          />
        </defs>
        <g>
          <use href="#icto-wave-path" opacity={op1}>
            <animateTransform
              attributeName="transform"
              attributeType="XML"
              type="translate"
              dur={dur1}
              calcMode="spline"
              values="270 230; -334 180; 270 230"
              keyTimes="0; .5; 1"
              keySplines="0.42, 0, 0.58, 1.0;0.42, 0, 0.58, 1.0"
              repeatCount="indefinite"
            />
          </use>
          <use href="#icto-wave-path" opacity={op2}>
            <animateTransform
              attributeName="transform"
              attributeType="XML"
              type="translate"
              dur={dur2}
              calcMode="spline"
              values="-270 230;243 220;-270 230"
              keyTimes="0; .6; 1"
              keySplines="0.42, 0, 0.58, 1.0;0.42, 0, 0.58, 1.0"
              repeatCount="indefinite"
            />
          </use>
          <use href="#icto-wave-path" opacity={op3}>
            <animateTransform
              attributeName="transform"
              attributeType="XML"
              type="translate"
              dur={dur3}
              calcMode="spline"
              values="0 230;-140 200;0 230"
              keyTimes="0; .4; 1"
              keySplines="0.42, 0, 0.58, 1.0;0.42, 0, 0.58, 1.0"
              repeatCount="indefinite"
            />
          </use>
        </g>
      </svg>
    </div>
  )
}
