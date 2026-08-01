import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const exporter = readFileSync('src/lib/utils/export.ts', 'utf8');
const tauriLib = readFileSync('src-tauri/src/lib.rs', 'utf8');

test('Windows PDF export uses WebView2 settings that suppress print headers and footers', () => {
	assert.match(exporter, /export async function exportAsPdf\(ctx: PdfExportContext\)/);
	assert.match(exporter, /if \(ctx\.osType !== 'windows'\) \{\s*await invoke\('print_pdf'\);/);
	assert.match(exporter, /filters: \[\{ name: 'PDF', extensions: \['pdf'\] \}\]/);
	assert.match(exporter, /invoke\('export_pdf_windows', \{ path: selected \}\)/);
	assert.match(tauriLib, /async fn export_pdf_windows\(/);
	assert.match(tauriLib, /fn print_pdf\(window: tauri::WebviewWindow\) -> Result<\(\), String> \{\s*window\.print\(\)/);
	assert.match(tauriLib, /save_file_content,\s*\n\s*export_pdf_windows,\s*\n\s*print_pdf,/);
	assert.match(tauriLib, /SetShouldPrintHeaderAndFooter\(false\)/);
	assert.match(tauriLib, /PrintToPdf\(/);
	assert.match(tauriLib, /use webview2_com::\{\s*PrintToPdfCompletedHandler,/);
	assert.doesNotMatch(tauriLib, /callback::PrintToPdfCompletedHandler/);
	assert.match(tauriLib, /recv_timeout\(Duration::from_secs\(60\)\)/);
});
