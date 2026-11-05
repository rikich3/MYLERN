import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url)));
const worker = read('worker_despacho.json');
const node = name => worker.nodes.find(n => n.name === name);
const run = (name, json, env = {}) => new Function('$input', '$env', node(name).parameters.jsCode)({first: () => ({json}), all: () => [{json}]}, env);
const evaluate = (expression, json, env = {}) => new Function('$json', '$env', `return (${expression.slice(3, -2)});`)(json, env);
test('flujos importables, inactivos y conexiones validas', () => {
  for (const w of [worker, read('ejecutar_cada_1_UE.json'), read('WhatsApp_input.json')]) {
    assert.equal(w.active, false);
    assert.equal(w.id, undefined);
    const names = new Set(w.nodes.map(n => n.name));
    assert.equal(names.size, w.nodes.length);
    for (const [source, outputs] of Object.entries(w.connections)) {
      assert.ok(names.has(source));
      for (const edges of outputs.main) for (const edge of edges) assert.ok(names.has(edge.node));
    }
  }
});
test('payload v2 mantiene texto literal y destino sin depender de Telegram', () => {
  const p = node('Enviar esfuerzo a WhatsApp').parameters;
  const contenido = '¿A < B & C? "sí"\nsegunda línea';
  assert.deepEqual(JSON.parse(evaluate(p.jsonBody, {item: {contenido, chat_id: null}})), {number: '51991436832', text: contenido, linkPreview: false});
  assert.equal(evaluate(p.url, {}, {EVOLUTION_API_BASE:'https://evo.test///', EVOLUTION_INSTANCE:'mi instancia'}), 'https://evo.test/message/sendText/mi%20instancia');
  assert.equal(p.headerParameters.parameters[0].name, 'apikey');
  assert.equal(node('Hay esfuerzo para enviar?').parameters.conditions.conditions.length, 1);
});
test('configuracion se valida antes de reclamar', () => {
  assert.equal(worker.connections['Cada minuto'].main[0][0].node, 'Validar configuracion');
  assert.equal(worker.connections['Validar configuracion'].main[0][0].node, 'Reclamar esfuerzo');
  assert.throws(() => run('Validar configuracion', {}, {}), /EVOLUTION_API_BASE/);
  run('Validar configuracion', {}, {EVOLUTION_API_BASE:'https://evo.test', EVOLUTION_INSTANCE:'milern', EVOLUTION_API_KEY:'test'});
});
test('solo respuestas aceptadas se confirman; error va a fallo', () => {
  for (const status of ['PENDING', 'SERVER_ACK', 'DELIVERY_ACK', 'READ', 'PLAYED']) {
    run('Validar respuesta Evolution', {key:{id:'ABC123', fromMe:true}, status});
  }
  for (const response of [{}, {error:'unauthorized'}, {key:{id:'ABC',fromMe:true},status:'ERROR'}, {key:{id:'',fromMe:true},status:'PENDING'}, {key:{id:'ABC',fromMe:false},status:'PENDING'}]) {
    assert.throws(() => run('Validar respuesta Evolution', response), /confirmacion/);
  }
  assert.equal(worker.connections['Enviar esfuerzo a WhatsApp'].main[0][0].node, 'Validar respuesta Evolution');
  for (const name of ['Enviar esfuerzo a WhatsApp', 'Validar respuesta Evolution']) {
    assert.equal(node(name).onError, 'continueErrorOutput');
    assert.equal(worker.connections[name].main[1][0].node, 'Registrar fallo de envio');
  }
  assert.equal(worker.connections['Validar respuesta Evolution'].main[0][0].node, 'Confirmar recepcion');
  assert.equal(node('Confirmar recepcion').retryOnFail, undefined);
  assert.deepEqual(JSON.parse(evaluate(node('Confirmar recepcion').parameters.jsonBody, {})), {telegram_message_id:null});
});

const incoming = read('WhatsApp_input.json');
const filterIncoming = (text, changes = {}) => {
  const body = {event: 'messages.upsert', instance: 'milern', data: {
    key: {fromMe: false, remoteJid: '51991436832@s.whatsapp.net'},
    message: {conversation: text},
  }, ...changes};
  return new Function('$input', '$env', incoming.nodes.find(n => n.name === 'Filtrar @milern').parameters.jsCode)(
    {first: () => ({json: {body}})}, {EVOLUTION_INSTANCE: 'milern'});
};
test('solo acepta el tag literal al inicio y separado', () => {
  for (const text of ['@milern pregunta | respuesta', '@milern\n/stats', '@milern']) {
    assert.deepEqual(filterIncoming(text), [{json: {number: '51991436832', text}}]);
  }
  for (const text of ['pregunta | respuesta', 'hola @milern', ' @milern /stats', '@milerna /stats', '@MILERN /stats', '', undefined]) {
    assert.deepEqual(filterIncoming(text), []);
  }
});
test('ignora ecos, otros eventos, instancias, remitentes y grupos', () => {
  assert.deepEqual(filterIncoming('@milern /stats', {event:'messages.update'}), []);
  assert.deepEqual(filterIncoming('@milern /stats', {instance:'otra'}), []);
  for (const key of [
    {fromMe:true, remoteJid:'51991436832@s.whatsapp.net'},
    {fromMe:false, remoteJid:'otro@s.whatsapp.net'},
    {fromMe:false, remoteJid:'grupo@g.us', remoteJidAlt:'51991436832@s.whatsapp.net'},
  ]) assert.deepEqual(filterIncoming('', {data:{key, message:{conversation:'@milern /stats'}}}), []);
  assert.equal(filterIncoming('', {data:{key:{fromMe:false, remoteJid:'123@lid',remoteJidAlt:'51991436832@s.whatsapp.net'}, message:{extendedTextMessage:{text:'@milern /stats'}}}}).length, 1);
});
test('entrada filtra antes del backend y requiere autenticacion de webhook', () => {
  assert.equal(incoming.nodes[0].parameters.authentication, 'headerAuth');
  assert.equal(incoming.connections['Recibir WhatsApp'].main[0][0].node, 'Filtrar @milern');
  assert.equal(incoming.connections['Filtrar @milern'].main[0][0].node, 'Enrutar al backend');
  assert.equal(incoming.active, false);
});
