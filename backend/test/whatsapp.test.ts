import test from 'node:test';
import assert from 'node:assert/strict';
import { procesarUpdate } from '../src/services/whatsapp.service.js';
import { procesarTexto } from '../src/services/telegram.service.js';

test('WhatsApp ignora sin consultar la base cuando falta tag o numero autorizado', async () => {
  for (const text of ['hola', 'hola @milern', ' @milern /listar', '@milernotro', '@MILERN']) {
    assert.deepEqual(await procesarUpdate({ number: '51991436832', text }), {ignored: true});
  }
  assert.deepEqual(await procesarUpdate({number: '123', text: '@milern /listar'}), {ignored: true});
});
test('tag solo muestra ayuda y elimina prefijo antes de detectar comando', async () => {
  for (const text of ['@milern', '@milern /ayuda', '@milern\n/ayuda']) {
    const response = await procesarUpdate({number: '51991436832', text});
    assert.equal(response.ignored, false);
    assert.match('texto' in response ? response.texto : '', /Comandos de control/);
  }
});
test('comandos compartidos no adoptan cuenta cuando el resolvedor rechaza', async () => {
  const result = await procesarTexto('51991436832', '/listar', async () => null, 'n8n');
  assert.equal(result.ok, false);
});
