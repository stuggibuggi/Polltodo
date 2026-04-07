export function DotsInfinityLoader() {
  return (
    <div className="dotsInfinityLoader" aria-hidden="true">
      <div className="dotsInfinityChrome">
        <div />
        <div />
        <div />
      </div>
      <div className="dotsInfinityFallback">
        <div>
          <span />
        </div>
        <div>
          <span />
        </div>
        <div>
          <span />
        </div>
      </div>
      <svg xmlns="http://www.w3.org/2000/svg" version="1.1" className="dotsInfinitySvgDefs">
        <defs>
          <filter id="dotsInfinityGoo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
              result="goo"
            />
            <feBlend in="SourceGraphic" in2="goo" />
          </filter>
        </defs>
      </svg>
    </div>
  )
}

