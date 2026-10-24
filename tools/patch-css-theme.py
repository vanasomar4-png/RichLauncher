import re, glob, os, sys
css = r'C:\Users\XMr_agentX\Downloads\RichLauncher-recovery\source\src\renderer\css'

def read(name):
    raw = open(os.path.join(css, name), 'rb').read().decode('utf-8')
    return raw, '\r\n' in raw, raw.replace('\r\n', '\n')

def write(name, text, crlf):
    if crlf:
        text = text.replace('\n', '\r\n')
    open(os.path.join(css, name), 'wb').write(text.encode('utf-8'))

# 1. Literal colours -> theme variables (everything except tokens.css, where they are defined).
total = 0
for path in glob.glob(os.path.join(css, '*.css')):
    name = os.path.basename(path)
    if name in ('tokens.css', 'style.css'):
        continue
    raw, crlf, text = read(name)
    before = text
    text = re.sub(r'rgba\(\s*168,\s*240,\s*208,', 'rgba(var(--accent-rgb),', text)
    text = re.sub(r'rgba\(\s*125,\s*230,\s*184,', 'rgba(var(--accent-strong-rgb),', text)
    text = re.sub(r'rgba\(\s*(?:7,\s*13,\s*11|8,\s*14,\s*12),', 'rgba(var(--bg-rgb),', text)
    text = re.sub(r'#7de6b8(?![0-9a-fA-F])', 'var(--color-accent-strong)', text)
    # Popups of the tooltip and the assistant follow the theme too.
    if name in ('assistant.css', 'layout.css'):
        text = text.replace('#0f1a16', 'var(--color-panel)').replace('#0c1512', 'var(--color-panel)')
        text = text.replace('#15211c', 'color-mix(in srgb, var(--color-panel), #fff 7%)').replace('#101b17', 'color-mix(in srgb, var(--color-panel), #fff 4%)')
    if text != before:
        write(name, text, crlf)
        total += 1
        print('recoloured', name)

# 2. Background: dimming and blur settings.
raw, crlf, text = read('layout.css')
old = '  will-change: transform;\n}\n\n.app-background::after {'
if text.count(old) != 1:
    sys.exit('layout.css: background block not found')
text = text.replace(old, '''  will-change: transform;
  filter: blur(var(--bg-blur, 0px));
}

/* "Background brightness" setting: a dark veil over the picture. */
.app-background::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
  background: rgb(var(--bg-rgb));
  opacity: var(--bg-dim, 0);
  pointer-events: none;
}

.app-background::after {''')
write('layout.css', text, crlf)
print('layout.css background')

# 3. Tokens: variables behind the replaced literals + motion modes.
raw, crlf, text = read('tokens.css')
old = '  --sidebar-width: 92px;'
if text.count(old) != 1:
    sys.exit('tokens.css: sidebar width not found')
text = text.replace(old, '''  /* Channels of the colours above, for rgba(var(--accent-rgb), 0.2). The Appearance settings override them. */
  --accent-rgb: 168, 240, 208;
  --accent-strong-rgb: 125, 230, 184;
  --bg-rgb: 7, 13, 11;
  --surface-rgb: 14, 24, 21;
  --surface-strong-rgb: 10, 18, 16;
  --hover-rgb: 30, 48, 42;
  --color-panel: #0f1a16;
  --bg-dim: 0;
  --bg-blur: 0px;

  --sidebar-width: 92px;''')
text = text.rstrip('\n') + '''

/* Motion setting (Settings -> Appearance). */
html[data-motion="reduced"] {
  --duration-fast: 90ms;
  --duration-base: 140ms;
  --duration-slow: 220ms;
}

html[data-motion="off"] *,
html[data-motion="off"] *::before,
html[data-motion="off"] *::after {
  animation-duration: 1ms !important;
  animation-delay: 0ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 1ms !important;
  transition-delay: 0ms !important;
}
'''
write('tokens.css', text, crlf)
print('tokens.css')
