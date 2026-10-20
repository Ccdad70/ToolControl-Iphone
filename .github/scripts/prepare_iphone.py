from pathlib import Path
import re
p=Path('index.html')
s=p.read_text(encoding='utf-8')
patt=r'<label><input type="checkbox"[^\n]*?onchange="tcSetPrimarySms\(this\.checked\)"> Este teléfono (?:será el encargado de enviar los SMS|enviará los SMS)</label>'
s,n=re.subn(patt,'<p class="hint">📲 Los SMS automáticos se envían exclusivamente desde el Android de Gaylor. En iPhone no hay selector de teléfono encargado.</p>',s)
assert n==2, f'Expected 2 SMS selectors, found {n}'
a='<p class="hint">Actívalo en un solo teléfono para reducir SMS duplicados. Necesitas permiso Android para enviar mensajes.</p>'
assert s.count(a)==1
s=s.replace(a,'<p class="hint">El control de envío de SMS está reservado al administrador Gaylor en Android.</p>')
a="function tcSetPrimarySms(yes){if(!tcWorkspace)return toast('Primero conecta el inventario');localStorage.setItem('tc-sms-primary-'+tcWorkspace,yes?'yes':'no');syncSmsReminders();toast(yes?'Este celular enviará los SMS':'SMS desactivados en este teléfono')}"
assert s.count(a)==1
s=s.replace(a,"function tcSetPrimarySms(yes){return toast('La selección del teléfono SMS está reservada al Android de Gaylor.');}")
assert 'tc_delete_retired_tool' in s and 'Versión 2.2' in s
assert 'onchange="tcSetPrimarySms(this.checked)"' not in s
p.write_text(s,encoding='utf-8')
print('ToolControl iPhone 2.2: selector SMS eliminado')
