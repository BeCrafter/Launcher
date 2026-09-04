export type LogoVariant =
  | 'power'
  | 'rocket'
  | 'arrow'
  | 'gauge'
  | 'bolt'
  | 'stack'
  | 'bars'
  | 'letterL'

export const LOGO_VARIANTS: { id: LogoVariant; label: string }[] = [
  { id: 'power', label: '电源符号' },
  { id: 'rocket', label: '火箭剪影' },
  { id: 'arrow', label: '发射箭头' },
  { id: 'gauge', label: '仪表盘' },
  { id: 'bolt', label: '闪电' },
  { id: 'stack', label: '服务栈' },
  { id: 'bars', label: '均衡条' },
  { id: 'letterL', label: 'L 字标' }
]

// 几何与 scripts/gen-icon.mjs 的符号场严格同构（viewBox 256 = S；圆角顶点由 --dump-svg 输出）

const SQUIRCLE_PATH =
  'M 15 128 C 15 58 58 15 128 15 C 198 15 241 58 241 128 C 241 198 198 241 128 241 C 58 241 15 198 15 128 Z'

const ROCKET_POINTS =
  '124,44 131,40 132,41 132,41 133,42 132,44 161,128 187,187 185,195 184,195 183,195 182,195 181,193 147,179 144,190 130,206 128,206 127,205 126,205 124,205 132,205 112,196 112,194 113,193 112,191 112,190 109,179 75,193 67,190 67,189 67,188 67,188 69,187 95,128'

const ARROW_HEAD_POINTS =
  '132,35 126,32 125,33 125,33 124,34 124,35 96,85 97,92 98,92 98,92 99,93 100,92 156,92 162,88 161,87 161,87 161,86 160,85'

const BOLT_POINTS =
  '143,35 139,31 139,31 139,31 138,31 139,33 96,112 98,120 99,120 99,121 100,121 101,120 127,120 109,222 112,226 112,226 112,225 113,225 112,223 164,136 163,128 163,128 162,128 161,128 160,128 134,128'

const STACK_POINTS = [
  '69,156 74,148 74,148 75,148 76,148 76,148 134,148 141,153 141,154 141,154 141,155 141,156 141,193 136,200 136,200 135,200 134,200 134,200 76,200 69,195 69,194 69,194 69,193 69,193',
  '115,110 120,102 120,102 121,102 122,102 122,102 180,102 187,107 187,108 187,108 187,109 187,110 187,146 182,154 182,154 181,154 180,154 180,154 122,154 115,149 115,148 115,148 115,147 115,146',
  '69,63 74,56 74,56 75,56 76,56 76,56 134,56 141,61 141,62 141,62 141,63 141,63 141,100 136,108 136,108 135,108 134,108 134,108 76,108 69,103 69,102 69,102 69,101 69,100'
]

const L_POINTS =
  '87,78 94,66 95,66 96,66 97,67 99,67 106,67 119,74 118,75 118,76 118,77 118,78 118,159 157,159 170,166 169,167 169,168 169,169 169,170 169,178 162,190 161,190 160,190 159,189 157,189 99,189 86,182 87,181 87,180 87,179 87,178'

function Symbol({ variant }: { variant: LogoVariant }): React.JSX.Element {
  const stroke = 'var(--logo-symbol)'
  switch (variant) {
    case 'power':
      return (
        <g fill="none" stroke={stroke} strokeWidth="36" strokeLinecap="round">
          <circle cx="128" cy="145" r="78" strokeDasharray="408.4 81.7" transform="rotate(-60 128 145)" />
          <line x1="128" y1="36" x2="128" y2="128" />
        </g>
      )
    case 'rocket':
      return (
        <g>
          <polygon points={ROCKET_POINTS} fill={stroke} />
          <circle cx="128" cy="107" r="22" fill="url(#logo-grad)" />
        </g>
      )
    case 'arrow':
      return (
        <g fill="none" stroke={stroke} strokeWidth="33" strokeLinecap="round">
          <circle cx="128" cy="161" r="69" />
          <line x1="128" y1="51" x2="128" y2="189" />
          <polygon points={ARROW_HEAD_POINTS} fill={stroke} />
        </g>
      )
    case 'gauge':
      return (
        <g fill="none" stroke={stroke} strokeWidth="33" strokeLinecap="round">
          <circle cx="128" cy="157" r="73" />
          <line x1="128" y1="157" x2="160" y2="125" />
        </g>
      )
    case 'bolt':
      return <polygon points={BOLT_POINTS} fill={stroke} />
    case 'stack':
      return (
        <g>
          {STACK_POINTS.map((pts) => (
            <polygon key={pts.slice(0, 12)} points={pts} fill={stroke} />
          ))}
        </g>
      )
    case 'bars':
      return (
        <g fill="none" stroke={stroke} strokeWidth="26" strokeLinecap="round">
          <line x1="105" y1="128" x2="105" y2="189" />
          <line x1="128" y1="67" x2="128" y2="189" />
          <line x1="151" y1="97" x2="151" y2="189" />
        </g>
      )
    case 'letterL':
      return (
        <g>
          <polygon points={L_POINTS} fill={stroke} />
          <circle cx="179" cy="77" r="16" fill={stroke} />
        </g>
      )
  }
}

export default function Logo({
  variant = 'power',
  size = 48
}: {
  variant?: LogoVariant
  size?: number
}): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" role="img" aria-label="Launcher Logo">
      <defs>
        <linearGradient id="logo-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--logo-grad-a)" />
          <stop offset="50%" stopColor="var(--logo-grad-b)" />
          <stop offset="100%" stopColor="var(--logo-grad-c)" />
        </linearGradient>
      </defs>
      <path d={SQUIRCLE_PATH} fill="url(#logo-grad)" />
      <Symbol variant={variant} />
    </svg>
  )
}
