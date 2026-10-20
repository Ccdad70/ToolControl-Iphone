from pathlib import Path
import re
p=Path('index.html')
s=p.read_text(encoding='utf-8')
patt=r'<label><input type="checkbox"[^\n]*?onchange="tcSetPrimarySms\(this\.checked\)"> Este teléfono (?:será el encargado de enviar los SMS|enviará los SMS)</label>'
s,n=re.subn(patt,'<p class="hint">📲 El encargado de SMS se consulta desde Supabase y se sincroniza con Android. En iPhone solo se muestra su estado; los mensajes salen desde Android.</p>',s)
assert n==2, f'Expected 2 SMS selectors, found {n}'
a='<p class="hint">Actívalo en un solo teléfono para reducir SMS duplicados. Necesitas permiso Android para enviar mensajes.</p>'
assert s.count(a)==1
s=s.replace(a,'<p class="hint">La autorización para enviar SMS se asigna desde ToolControl Android. iPhone muestra el administrador autorizado.</p>')
a="function tcSetPrimarySms(yes){if(!tcWorkspace)return toast('Primero conecta el inventario');localStorage.setItem('tc-sms-primary-'+tcWorkspace,yes?'yes':'no');syncSmsReminders();toast(yes?'Este celular enviará los SMS':'SMS desactivados en este teléfono')}"
assert s.count(a)==1
s=s.replace(a,"function tcSetPrimarySms(yes){return toast('La autorización de envío SMS se administra desde Android. El encargado se consulta en Supabase.');}")
assert 'tc_delete_retired_tool' in s and 'Versión 2.2' in s
assert 'onchange="tcSetPrimarySms(this.checked)"' not in s
p.write_text(s,encoding='utf-8')
print('ToolControl iPhone 2.2: SMS sincronizado con Android, sin selector de envío')
