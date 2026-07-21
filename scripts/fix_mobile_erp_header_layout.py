from pathlib import Path

app_path = Path('src/App.tsx')
app = app_path.read_text(encoding='utf-8')

old = 'className="flex-1 min-w-0 flex items-center gap-2"'
new = 'className="hidden sm:flex flex-1 min-w-0 items-center gap-2"'

count = app.count(old)
if count != 1:
    raise RuntimeError(f'ERP header wrapper: expected one match, found {count}')

app_path.write_text(app.replace(old, new, 1), encoding='utf-8')
